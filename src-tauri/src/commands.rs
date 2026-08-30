use std::{
    collections::{BTreeMap, VecDeque},
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::{
    audio_output::{list_audio_output_devices, AudioOutputDevice},
    keyboard::{KeyboardSink, TrackedKeyboardOutput},
    midi_file::parse_midi_bytes,
    midi_input::{list_midi_input_devices, MidiInputDevice},
    midi_output::{list_midi_output_devices, MidiOutputDevice},
    model::{
        InputSource, KeyAction, KeyActionKind, MidiEvent, MidiEventType, PlaybackOutputMode,
        PlaybackTrackState, Preset,
    },
    passthrough_hotkeys::{
        PassthroughHotkeyBinding, PassthroughHotkeyInstallResult, PassthroughHotkeyManager,
    },
    playback_clock::{sanitize_speed, PlaybackClock},
    presets::built_in_presets,
    rule_engine::{actions_for_rule, matching_rules, TriggerState},
};

#[cfg(not(windows))]
use crate::keyboard::NoopKeyboardSink;

#[cfg(windows)]
use crate::keyboard::WindowsKeyboardSink;

#[cfg(windows)]
type PlatformKeyboardSink = WindowsKeyboardSink;

#[cfg(not(windows))]
type PlatformKeyboardSink = NoopKeyboardSink;

pub struct AppState {
    output_enabled: Arc<Mutex<bool>>,
    audition_enabled: Arc<Mutex<bool>>,
    keyboard: Arc<Mutex<TrackedKeyboardOutput<PlatformKeyboardSink>>>,
    playback: Mutex<Option<PlaybackRuntime>>,
    playback_tracks: Arc<Mutex<PlaybackTrackFilter>>,
    live_connection: Mutex<Option<midir::MidiInputConnection<()>>>,
    passthrough_hotkeys: Mutex<PassthroughHotkeyManager>,
    audition_output: Mutex<Result<Arc<crate::audio_output::AuditionOutput>, String>>,
}

struct PlaybackRuntime {
    cancel: Arc<AtomicBool>,
    release_on_cancel: Arc<AtomicBool>,
    clock: Arc<PlaybackClock>,
    handles: Vec<JoinHandle<()>>,
}

type PlaybackTrackFilter = BTreeMap<Option<u16>, bool>;

fn playback_track_filter_from_states(states: Vec<PlaybackTrackState>) -> PlaybackTrackFilter {
    states
        .into_iter()
        .map(|state| (state.track, state.enabled))
        .collect()
}

fn playback_track_allows(filter: &PlaybackTrackFilter, track: Option<u16>) -> bool {
    filter.get(&track).copied().unwrap_or(true)
}

impl AppState {
    pub fn new() -> Self {
        Self {
            output_enabled: Arc::new(Mutex::new(false)),
            audition_enabled: Arc::new(Mutex::new(false)),
            keyboard: Arc::new(Mutex::new(TrackedKeyboardOutput::new(
                platform_keyboard_sink(),
            ))),
            playback: Mutex::new(None),
            playback_tracks: Arc::new(Mutex::new(BTreeMap::new())),
            live_connection: Mutex::new(None),
            passthrough_hotkeys: Mutex::new(PassthroughHotkeyManager::new()),
            audition_output: Mutex::new(
                crate::audio_output::AuditionOutput::new()
                    .map(Arc::new)
                    .map_err(|err| err.to_string()),
            ),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub presets: Vec<Preset>,
    pub output_enabled: bool,
}

pub fn initial_snapshot() -> AppSnapshot {
    AppSnapshot {
        presets: built_in_presets(),
        output_enabled: false,
    }
}

pub fn build_actions_for_events(preset: &Preset, events: &[MidiEvent]) -> Vec<KeyAction> {
    let mut trigger_state = TriggerState::default();
    build_actions_for_events_with_state(preset, events, &mut trigger_state)
}

pub fn build_actions_for_events_from(
    preset: &Preset,
    events: &[MidiEvent],
    start_at_ms: u64,
) -> Vec<KeyAction> {
    build_actions_for_events(preset, events)
        .into_iter()
        .filter_map(|mut action| {
            if action.at_ms < start_at_ms {
                return None;
            }
            action.at_ms -= start_at_ms;
            Some(action)
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
struct PlaybackDispatchPlan {
    key_actions: Vec<KeyAction>,
    key_delay_ms: u64,
    midi_events: Vec<MidiEvent>,
    midi_delay_ms: u64,
}

fn build_playback_dispatch_plan(
    preset: &Preset,
    events: &[MidiEvent],
    start_at_ms: u64,
    _output_mode: PlaybackOutputMode,
) -> PlaybackDispatchPlan {
    let key_actions = build_actions_for_events_from(preset, events, start_at_ms);
    let relative_events = midi_events_from_seek(events, start_at_ms);
    let midi_events = mapped_midi_events_for_audition(preset, &relative_events);

    PlaybackDispatchPlan {
        key_actions,
        key_delay_ms: preset.playback.key_output_delay_ms,
        midi_events,
        midi_delay_ms: preset.playback.audition_delay_ms,
    }
}

fn mapped_midi_events_for_audition(preset: &Preset, events: &[MidiEvent]) -> Vec<MidiEvent> {
    let mut active_notes: BTreeMap<(Option<u16>, u8, u8), u16> = BTreeMap::new();
    let mut mapped_events = Vec::new();

    for event in events {
        match event.event_type {
            MidiEventType::ControlChange => {
                mapped_events.push(event.clone());
            }
            MidiEventType::NoteOn if event_has_audition_mapping(preset, event) => {
                *active_notes.entry(audition_note_key(event)).or_default() += 1;
                mapped_events.push(event.clone());
            }
            MidiEventType::NoteOff if take_active_audition_note(&mut active_notes, event) => {
                mapped_events.push(event.clone());
            }
            _ => {}
        }
    }

    mapped_events
}

fn event_has_audition_mapping(preset: &Preset, event: &MidiEvent) -> bool {
    matching_rules(preset, event)
        .iter()
        .any(|rule| rule.output.keys.iter().any(|key| !key.trim().is_empty()))
}

fn take_active_audition_note(
    active_notes: &mut BTreeMap<(Option<u16>, u8, u8), u16>,
    event: &MidiEvent,
) -> bool {
    let key = audition_note_key(event);
    let Some(count) = active_notes.get_mut(&key) else {
        return false;
    };

    if *count > 1 {
        *count -= 1;
    } else {
        active_notes.remove(&key);
    }
    true
}

fn audition_note_key(event: &MidiEvent) -> (Option<u16>, u8, u8) {
    (event.track, event.channel, event.note)
}

fn midi_events_from_seek(events: &[MidiEvent], start_at_ms: u64) -> Vec<MidiEvent> {
    let mut active_notes: BTreeMap<(Option<u16>, u8, u8), Vec<MidiEvent>> = BTreeMap::new();
    let mut active_controllers: BTreeMap<(Option<u16>, u8, u8), MidiEvent> = BTreeMap::new();
    let mut relative_events = Vec::new();
    let mut inserted_active_notes = false;

    for event in events {
        if event.at_ms < start_at_ms {
            update_active_midi_notes(&mut active_notes, event);
            update_active_midi_controllers(&mut active_controllers, event);
            continue;
        }

        if !inserted_active_notes {
            for active_event in active_controllers.values() {
                let mut event = active_event.clone();
                event.at_ms = 0;
                relative_events.push(event);
            }
            for active_event in active_notes.values().flat_map(|events| events.iter()) {
                let mut event = active_event.clone();
                event.at_ms = 0;
                relative_events.push(event);
            }
            inserted_active_notes = true;
        }

        let mut event = event.clone();
        event.at_ms -= start_at_ms;
        relative_events.push(event);
    }

    if !inserted_active_notes {
        for active_event in active_controllers.values() {
            let mut event = active_event.clone();
            event.at_ms = 0;
            relative_events.push(event);
        }
        for active_event in active_notes.values().flat_map(|events| events.iter()) {
            let mut event = active_event.clone();
            event.at_ms = 0;
            relative_events.push(event);
        }
    }

    relative_events
}

fn update_active_midi_notes(
    active_notes: &mut BTreeMap<(Option<u16>, u8, u8), Vec<MidiEvent>>,
    event: &MidiEvent,
) {
    let key = audition_note_key(event);
    match event.event_type {
        MidiEventType::NoteOn if event.velocity > 0 => {
            active_notes.entry(key).or_default().push(event.clone());
        }
        MidiEventType::NoteOn | MidiEventType::NoteOff => {
            if let Some(events) = active_notes.get_mut(&key) {
                events.pop();
                if events.is_empty() {
                    active_notes.remove(&key);
                }
            }
        }
        MidiEventType::Both => {}
        MidiEventType::ControlChange => {}
    }
}

fn update_active_midi_controllers(
    active_controllers: &mut BTreeMap<(Option<u16>, u8, u8), MidiEvent>,
    event: &MidiEvent,
) {
    if event.event_type != MidiEventType::ControlChange {
        return;
    }

    let key = audition_note_key(event);
    if event.velocity > 0 {
        active_controllers.insert(key, event.clone());
    } else {
        active_controllers.remove(&key);
    }
}

fn playback_speed(preset: &Preset) -> f64 {
    sanitize_speed(preset.playback.speed as f64)
}

fn build_actions_for_events_with_state(
    preset: &Preset,
    events: &[MidiEvent],
    trigger_state: &mut TriggerState,
) -> Vec<KeyAction> {
    let mut actions = Vec::new();

    for event in events {
        for rule in matching_rules(preset, event) {
            actions.extend(actions_for_rule(rule, event, trigger_state));
        }
    }

    actions.sort_by_key(|action| {
        (
            action.at_ms,
            match action.kind {
                KeyActionKind::Up => 0,
                KeyActionKind::Down => 1,
            },
        )
    });
    actions
}

#[tauri::command]
pub fn get_app_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    let output_enabled = *state
        .output_enabled
        .lock()
        .map_err(|_| "output state lock is poisoned".to_string())?;

    Ok(AppSnapshot {
        output_enabled,
        ..initial_snapshot()
    })
}

#[tauri::command]
pub fn list_midi_inputs() -> Result<Vec<MidiInputDevice>, String> {
    list_midi_input_devices().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_midi_outputs() -> Result<Vec<MidiOutputDevice>, String> {
    list_midi_output_devices().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_audio_outputs() -> Result<Vec<AudioOutputDevice>, String> {
    list_audio_output_devices().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_audio_output_device(
    device_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<AudioOutputDevice>, String> {
    let output = state
        .audition_output
        .lock()
        .map_err(|_| "audition output lock is poisoned".to_string())?;
    let output = output.as_ref().map_err(|err| err.clone())?.clone();
    output.set_device(device_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn parse_midi_file(path: String) -> Result<Vec<MidiEvent>, String> {
    let bytes = fs::read(&path).map_err(|err| format!("failed to read MIDI file: {err}"))?;
    parse_midi_bytes(&bytes).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_midi_files_near(path: String) -> Result<Vec<String>, String> {
    let source = Path::new(&path);
    let dir = source
        .parent()
        .ok_or_else(|| format!("failed to read parent folder for {path}"))?;

    list_midi_files_in_dir(dir)
}

#[tauri::command]
pub fn set_passthrough_hotkeys(
    app: AppHandle,
    state: State<'_, AppState>,
    hotkeys: Vec<PassthroughHotkeyBinding>,
) -> Result<PassthroughHotkeyInstallResult, String> {
    state
        .passthrough_hotkeys
        .lock()
        .map_err(|_| "hotkey state lock is poisoned".to_string())?
        .install(app, hotkeys)
}

#[tauri::command]
pub fn clear_passthrough_hotkeys(state: State<'_, AppState>) -> Result<(), String> {
    state
        .passthrough_hotkeys
        .lock()
        .map_err(|_| "hotkey state lock is poisoned".to_string())?
        .clear();
    Ok(())
}

#[tauri::command]
pub fn import_preset_file(path: String) -> Result<Preset, String> {
    let bytes = fs::read(&path).map_err(|err| format!("failed to read preset file: {err}"))?;
    serde_json::from_slice(&bytes).map_err(|err| format!("failed to parse preset JSON: {err}"))
}

#[tauri::command]
pub fn export_preset_file(path: String, preset: Preset) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&preset)
        .map_err(|err| format!("failed to serialize preset: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("failed to write preset file: {err}"))
}

#[tauri::command]
pub fn play_midi_file(
    path: String,
    preset: Preset,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    play_midi_file_from(path, 0, preset, state)
}

#[tauri::command]
pub fn play_midi_file_from(
    path: String,
    start_at_ms: u64,
    preset: Preset,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let bytes = fs::read(&path).map_err(|err| format!("failed to read MIDI file: {err}"))?;
    let events = parse_midi_bytes(&bytes).map_err(|err| err.to_string())?;
    start_event_playback(
        events,
        start_at_ms,
        preset,
        PlaybackOutputMode::Keys,
        Vec::new(),
        false,
        state,
    )
}

#[tauri::command]
pub fn play_midi_events_from(
    events: Vec<MidiEvent>,
    start_at_ms: u64,
    preset: Preset,
    output_mode: PlaybackOutputMode,
    playback_tracks: Option<Vec<PlaybackTrackState>>,
    seamless: Option<bool>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    start_event_playback(
        events,
        start_at_ms,
        preset,
        output_mode,
        playback_tracks.unwrap_or_default(),
        seamless.unwrap_or(false),
        state,
    )
}

fn start_event_playback(
    events: Vec<MidiEvent>,
    start_at_ms: u64,
    preset: Preset,
    output_mode: PlaybackOutputMode,
    playback_tracks: Vec<PlaybackTrackState>,
    seamless: bool,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    stop_existing_playback(&state, !seamless, true)?;
    if !seamless {
        release_all(&state)?;
    }
    set_playback_track_filter(&state, playback_tracks)?;
    set_audition_enabled_for_mode(&state, output_mode)?;

    let plan = build_playback_dispatch_plan(&preset, &events, start_at_ms, output_mode);
    let action_count = plan.key_actions.len() + plan.midi_events.len();
    let cancel = Arc::new(AtomicBool::new(false));
    let release_on_cancel = Arc::new(AtomicBool::new(true));
    let clock = Arc::new(PlaybackClock::new(playback_speed(&preset)));
    let mut handles = Vec::new();

    let audition_output = {
        let guard = state
            .audition_output
            .lock()
            .map_err(|_| "audition output lock is poisoned".to_string())?;
        match output_mode {
            PlaybackOutputMode::Keys => match guard.as_ref() {
                Ok(output) => Some(output.clone()),
                Err(_) => None,
            },
            PlaybackOutputMode::Audition | PlaybackOutputMode::Both => {
                Some(guard.as_ref().map_err(|err| err.clone())?.clone())
            }
        }
    };

    if let Some(output) = audition_output {
        if matches!(output_mode, PlaybackOutputMode::Audition | PlaybackOutputMode::Both)
            && !output.has_stream()
        {
            let opened = output
                .set_device(output.requested_id())
                .map_err(|err| err.to_string())?;
            if opened.is_none() {
                return Err("no playback device found".to_string());
            }
        }

        if let Some(handle) = crate::audition_engine::dispatch_audition_events(
            plan.midi_events,
            clock.clone(),
            plan.midi_delay_ms,
            cancel.clone(),
            state.audition_enabled.clone(),
            state.playback_tracks.clone(),
            output.synth(),
        ) {
            handles.push(handle);
        }
    }

    if let Some(handle) = dispatch_actions(
        plan.key_actions,
        clock.clone(),
        plan.key_delay_ms,
        state.output_enabled.clone(),
        state.keyboard.clone(),
        state.playback_tracks.clone(),
        release_on_cancel.clone(),
        cancel.clone(),
    ) {
        handles.push(handle);
    }

    if !handles.is_empty() {
        *state
            .playback
            .lock()
            .map_err(|_| "playback state lock is poisoned".to_string())? = Some(PlaybackRuntime {
            cancel,
            release_on_cancel,
            clock,
            handles,
        });
    }

    Ok(action_count)
}

#[tauri::command]
pub fn set_playback_speed(speed: f64, state: State<'_, AppState>) -> Result<f64, String> {
    let speed = sanitize_speed(speed);
    if let Some(runtime) = state
        .playback
        .lock()
        .map_err(|_| "playback state lock is poisoned".to_string())?
        .as_ref()
    {
        return Ok(runtime.clock.set_speed(speed));
    }
    Ok(speed)
}

#[tauri::command]
pub fn set_playback_tracks(
    tracks: Vec<PlaybackTrackState>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    set_playback_track_filter(&state, tracks)
}

#[tauri::command]
pub fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    stop_existing_playback(&state, true, true)?;
    release_all(&state)
}

#[tauri::command]
pub fn set_output_enabled(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    let mut output_enabled = state
        .output_enabled
        .lock()
        .map_err(|_| "output state lock is poisoned".to_string())?;
    *output_enabled = enabled;
    Ok(enabled)
}

#[tauri::command]
pub fn set_audition_enabled(state: State<'_, AppState>, enabled: bool) -> Result<bool, String> {
    {
        let mut audition_enabled = state
            .audition_enabled
            .lock()
            .map_err(|_| "audition state lock is poisoned".to_string())?;
        *audition_enabled = enabled;
    }

    if !enabled {
        if let Ok(guard) = state.audition_output.lock() {
            if let Ok(output) = guard.as_ref() {
                if let Ok(mut synth) = output.synth().lock() {
                    synth.all_notes_off();
                }
            }
        }
    }

    Ok(enabled)
}

#[tauri::command]
pub fn panic_release_all_keys(state: State<'_, AppState>) -> Result<(), String> {
    release_all(&state)
}

#[tauri::command]
pub fn start_live_input(
    device_id: usize,
    preset: Preset,
    state: State<'_, AppState>,
) -> Result<(), String> {
    stop_live_input(state.clone())?;

    let input =
        midir::MidiInput::new("SlimeKeys").map_err(|err| format!("MIDI input failed: {err}"))?;
    let ports = input.ports();
    let port = ports
        .get(device_id)
        .ok_or_else(|| format!("MIDI input device {device_id} was not found"))?;
    let port_name = input
        .port_name(port)
        .map_err(|err| format!("failed to read MIDI input name: {err}"))?;
    let output_enabled = state.output_enabled.clone();
    let keyboard = state.keyboard.clone();
    let mut trigger_state = TriggerState::default();

    let connection = input
        .connect(
            port,
            "SlimeKeys live input",
            move |_timestamp, message, _| {
                if let Some(event) = midi_message_to_event(message) {
                    let actions =
                        build_actions_for_events_with_state(&preset, &[event], &mut trigger_state);
                    let _ = dispatch_actions(
                        actions,
                        Arc::new(PlaybackClock::new(1.0)),
                        0,
                        output_enabled.clone(),
                        keyboard.clone(),
                        Arc::new(Mutex::new(BTreeMap::new())),
                        Arc::new(AtomicBool::new(true)),
                        Arc::new(AtomicBool::new(false)),
                    );
                }
            },
            (),
        )
        .map_err(|err| format!("failed to open MIDI input {port_name}: {err}"))?;

    *state
        .live_connection
        .lock()
        .map_err(|_| "live input state lock is poisoned".to_string())? = Some(connection);

    Ok(())
}

#[cfg(test)]
fn build_file_playback_actions(
    preset: &Preset,
    bytes: &[u8],
    start_at_ms: u64,
) -> Result<Vec<KeyAction>, String> {
    let events = parse_midi_bytes(bytes).map_err(|err| err.to_string())?;
    Ok(build_actions_for_events_from(preset, &events, start_at_ms))
}

#[tauri::command]
pub fn stop_live_input(state: State<'_, AppState>) -> Result<(), String> {
    let connection = state
        .live_connection
        .lock()
        .map_err(|_| "live input state lock is poisoned".to_string())?
        .take();
    drop(connection);
    release_all(&state)
}

#[cfg(windows)]
fn platform_keyboard_sink() -> PlatformKeyboardSink {
    WindowsKeyboardSink
}

#[cfg(not(windows))]
fn platform_keyboard_sink() -> PlatformKeyboardSink {
    NoopKeyboardSink
}

fn stop_existing_playback(
    state: &State<'_, AppState>,
    release_on_cancel: bool,
    wait_for_shutdown: bool,
) -> Result<(), String> {
    if let Some(runtime) = state
        .playback
        .lock()
        .map_err(|_| "playback state lock is poisoned".to_string())?
        .take()
    {
        runtime
            .release_on_cancel
            .store(release_on_cancel, Ordering::SeqCst);
        runtime.cancel.store(true, Ordering::SeqCst);
        if wait_for_shutdown {
            for handle in runtime.handles {
                let _ = handle.join();
            }
        }
    }
    Ok(())
}

fn release_all(state: &State<'_, AppState>) -> Result<(), String> {
    state
        .keyboard
        .lock()
        .map_err(|_| "keyboard state lock is poisoned".to_string())?
        .release_all()
        .map_err(|err| err.to_string())
}

fn set_playback_track_filter(
    state: &State<'_, AppState>,
    tracks: Vec<PlaybackTrackState>,
) -> Result<(), String> {
    *state
        .playback_tracks
        .lock()
        .map_err(|_| "playback track state lock is poisoned".to_string())? =
        playback_track_filter_from_states(tracks);
    Ok(())
}

fn set_audition_enabled_for_mode(
    state: &State<'_, AppState>,
    output_mode: PlaybackOutputMode,
) -> Result<(), String> {
    let enabled = matches!(
        output_mode,
        PlaybackOutputMode::Audition | PlaybackOutputMode::Both
    );
    *state
        .audition_enabled
        .lock()
        .map_err(|_| "audition state lock is poisoned".to_string())? = enabled;
    Ok(())
}

fn list_midi_files_in_dir(dir: &Path) -> Result<Vec<String>, String> {
    let mut files = fs::read_dir(dir)
        .map_err(|err| format!("failed to read MIDI folder: {err}"))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_midi_file_path(path))
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    files.sort_by_key(|path| {
        Path::new(path)
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    });

    Ok(files)
}

fn is_midi_file_path(path: &Path) -> bool {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .is_some_and(|extension| extension == "mid" || extension == "midi")
}

fn dispatch_actions<S>(
    actions: Vec<KeyAction>,
    clock: Arc<PlaybackClock>,
    output_delay_ms: u64,
    output_enabled: Arc<Mutex<bool>>,
    keyboard: Arc<Mutex<TrackedKeyboardOutput<S>>>,
    playback_tracks: Arc<Mutex<PlaybackTrackFilter>>,
    release_on_cancel: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
) -> Option<JoinHandle<()>>
where
    S: KeyboardSink + Send + 'static,
{
    if actions.is_empty() {
        return None;
    }

    Some(thread::spawn(move || {
        let mut next_index = 0;
        let mut pending_actions: VecDeque<(Instant, KeyAction)> = VecDeque::new();

        while !cancel.load(Ordering::SeqCst) {
            let now = Instant::now();
            let position_ms = clock.position_ms();
            while next_index < actions.len() && actions[next_index].at_ms as f64 <= position_ms {
                pending_actions.push_back((
                    now + Duration::from_millis(output_delay_ms),
                    actions[next_index].clone(),
                ));
                next_index += 1;
            }

            loop {
                let ready = pending_actions
                    .front()
                    .map(|(due_at, _)| *due_at <= Instant::now())
                    .unwrap_or(false);
                if !ready {
                    break;
                }

                let Some((_, action)) = pending_actions.pop_front() else {
                    break;
                };

                let enabled = output_enabled
                    .lock()
                    .map(|enabled| *enabled)
                    .unwrap_or(false);
                if !enabled {
                    continue;
                }

                if action.kind == KeyActionKind::Down
                    && !playback_tracks
                        .lock()
                        .map(|tracks| playback_track_allows(&tracks, action.track))
                        .unwrap_or(true)
                {
                    continue;
                }

                if let Ok(mut keyboard) = keyboard.lock() {
                    let _ = match action.kind {
                        KeyActionKind::Down => keyboard.key_down(&action.key),
                        KeyActionKind::Up => keyboard.key_up(&action.key),
                    };
                }
            }

            if next_index >= actions.len() && pending_actions.is_empty() {
                break;
            }

            thread::sleep(
                pending_actions
                    .front()
                    .map(|(due_at, _)| due_at.saturating_duration_since(Instant::now()))
                    .unwrap_or_else(|| Duration::from_millis(1))
                    .min(Duration::from_millis(1)),
            );
        }

        if cancel.load(Ordering::SeqCst) && release_on_cancel.load(Ordering::SeqCst) {
            if let Ok(mut keyboard) = keyboard.lock() {
                let _ = keyboard.release_all();
            }
        }
    }))
}

fn midi_message_to_event(message: &[u8]) -> Option<MidiEvent> {
    if message.len() < 3 {
        return None;
    }

    let status = message[0] & 0xF0;
    let channel = (message[0] & 0x0F) + 1;
    let note = message[1];
    let velocity = message[2];

    match status {
        0x90 if velocity > 0 => Some(MidiEvent::note_on(
            InputSource::Live,
            None,
            channel,
            note,
            velocity,
            0,
        )),
        0x90 | 0x80 => Some(MidiEvent::note_off(
            InputSource::Live,
            None,
            channel,
            note,
            velocity,
            0,
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presets::genshin_21_key_preset;
    use std::path::PathBuf;

    #[test]
    fn app_snapshot_contains_default_preset_and_no_active_output() {
        let snapshot = initial_snapshot();

        assert_eq!(snapshot.presets.len(), 2);
        assert_eq!(snapshot.presets[0].id, "genshin-21-key");
        assert_eq!(snapshot.presets[1].id, "genshin-old-lyre");
        assert!(!snapshot.output_enabled);
    }

    #[test]
    fn builds_keyboard_actions_from_default_preset_events() {
        let preset = genshin_21_key_preset();
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 180),
        ];

        let actions = build_actions_for_events(&preset, &events);

        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].key, "Z");
        assert_eq!(actions[0].kind, crate::model::KeyActionKind::Down);
        assert_eq!(actions[0].at_ms, 100);
        assert_eq!(actions[1].key, "Z");
        assert_eq!(actions[1].kind, crate::model::KeyActionKind::Up);
        assert_eq!(actions[1].at_ms, 180);
    }

    #[test]
    fn builds_file_playback_actions_from_supplied_preset() {
        let mut preset = genshin_21_key_preset();
        let mut custom_rule = preset
            .rules
            .iter()
            .find(|rule| rule.name == "C4 -> A")
            .unwrap()
            .clone();
        custom_rule.output.keys = vec!["P".to_string()];
        preset.rules = vec![custom_rule];

        let actions = build_file_playback_actions(&preset, &simple_midi_bytes(), 0).unwrap();

        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].key, "P");
        assert_eq!(actions[1].key, "P");
    }

    #[test]
    fn builds_keyboard_actions_from_seek_offset_relative_to_seek_start() {
        let preset = genshin_21_key_preset();
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 50, 90, 300),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 50, 0, 390),
        ];

        let actions = build_actions_for_events_from(&preset, &events, 200);

        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].key, "X");
        assert_eq!(actions[0].kind, crate::model::KeyActionKind::Down);
        assert_eq!(actions[0].at_ms, 100);
        assert_eq!(actions[1].key, "X");
        assert_eq!(actions[1].kind, crate::model::KeyActionKind::Up);
        assert_eq!(actions[1].at_ms, 190);
    }

    #[test]
    fn keeps_file_playback_actions_on_midi_time_when_speed_changes() {
        let mut preset = genshin_21_key_preset();
        preset.playback.speed = 0.5;
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 180),
        ];

        let actions = build_actions_for_events_from(&preset, &events, 0);

        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].at_ms, 100);
        assert_eq!(actions[1].at_ms, 180);
    }

    #[test]
    fn playback_dispatch_plan_filters_from_seek_and_prepares_both_outputs() {
        let preset = genshin_21_key_preset();
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 180),
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 50, 80, 300),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 50, 0, 390),
        ];

        let keys = build_playback_dispatch_plan(
            &preset,
            &events,
            200,
            crate::model::PlaybackOutputMode::Keys,
        );
        assert_eq!(keys.key_actions.len(), 2);
        assert_eq!(keys.midi_events.len(), 2);
        assert_eq!(keys.key_actions[0].at_ms, 100);

        let audition = build_playback_dispatch_plan(
            &preset,
            &events,
            200,
            crate::model::PlaybackOutputMode::Audition,
        );
        assert_eq!(audition.key_actions.len(), 2);
        assert_eq!(audition.midi_events.len(), 2);
        assert_eq!(audition.midi_events[0].at_ms, 100);

        let both = build_playback_dispatch_plan(
            &preset,
            &events,
            200,
            crate::model::PlaybackOutputMode::Both,
        );
        assert_eq!(both.key_actions.len(), 2);
        assert_eq!(both.midi_events.len(), 2);
    }

    #[test]
    fn playback_dispatch_plan_applies_independent_positive_output_delays() {
        let mut preset = genshin_21_key_preset();
        preset.playback.key_output_delay_ms = 1_000;
        preset.playback.audition_delay_ms = 250;
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 180),
        ];

        let both = build_playback_dispatch_plan(
            &preset,
            &events,
            0,
            crate::model::PlaybackOutputMode::Both,
        );

        assert_eq!(both.key_delay_ms, 1_000);
        assert_eq!(both.midi_delay_ms, 250);
        assert_eq!(both.key_actions[0].at_ms, 100);
        assert_eq!(both.key_actions[1].at_ms, 180);
        assert_eq!(both.midi_events[0].at_ms, 100);
        assert_eq!(both.midi_events[1].at_ms, 180);
    }

    #[test]
    fn midi_audition_restarts_active_notes_when_seeking_inside_a_long_note() {
        let preset = genshin_21_key_preset();
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 700),
        ];

        let audition = build_playback_dispatch_plan(
            &preset,
            &events,
            300,
            crate::model::PlaybackOutputMode::Audition,
        );

        assert_eq!(
            audition
                .midi_events
                .iter()
                .map(|event| (event.event_type, event.note, event.at_ms))
                .collect::<Vec<_>>(),
            vec![
                (crate::model::MidiEventType::NoteOn, 48, 0),
                (crate::model::MidiEventType::NoteOff, 48, 400),
            ],
        );
    }

    #[test]
    fn audition_dispatch_plan_filters_out_unmapped_notes() {
        let preset = genshin_21_key_preset();
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 180),
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 49, 90, 220),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 49, 0, 300),
        ];

        let audition = build_playback_dispatch_plan(
            &preset,
            &events,
            0,
            crate::model::PlaybackOutputMode::Audition,
        );

        assert_eq!(
            audition
                .midi_events
                .iter()
                .map(|event| (event.note, event.event_type))
                .collect::<Vec<_>>(),
            vec![
                (48, crate::model::MidiEventType::NoteOn),
                (48, crate::model::MidiEventType::NoteOff),
            ],
        );
    }

    #[test]
    fn audition_keeps_note_off_for_note_on_only_mapping() {
        let mut preset = genshin_21_key_preset();
        let mut note_on_rule = preset
            .rules
            .iter()
            .find(|rule| rule.name == "C3 -> Z")
            .unwrap()
            .clone();
        note_on_rule.event_type = crate::model::MidiEventType::NoteOn;
        note_on_rule.trigger_mode = crate::model::TriggerMode::Tap;
        preset.rules = vec![note_on_rule];
        let events = vec![
            MidiEvent::note_on(crate::model::InputSource::File, Some(0), 1, 48, 90, 100),
            MidiEvent::note_off(crate::model::InputSource::File, Some(0), 1, 48, 0, 700),
        ];

        let audition = build_playback_dispatch_plan(
            &preset,
            &events,
            0,
            crate::model::PlaybackOutputMode::Audition,
        );

        assert_eq!(audition.midi_events.len(), 2);
        assert_eq!(
            audition.midi_events[0].event_type,
            crate::model::MidiEventType::NoteOn
        );
        assert_eq!(
            audition.midi_events[1].event_type,
            crate::model::MidiEventType::NoteOff
        );
    }

    #[test]
    fn list_midi_files_in_dir_includes_midi_extensions_and_sorts_names() {
        let dir =
            create_test_dir("list_midi_files_in_dir_includes_midi_extensions_and_sorts_names");
        fs::write(dir.join("beta.midi"), []).unwrap();
        fs::write(dir.join("alpha.mid"), []).unwrap();
        fs::write(dir.join("notes.txt"), []).unwrap();

        let files = list_midi_files_in_dir(&dir).unwrap();

        assert_eq!(
            file_names(&files),
            vec!["alpha.mid".to_string(), "beta.midi".to_string()]
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn list_midi_files_in_dir_matches_extensions_case_insensitively() {
        let dir = create_test_dir("list_midi_files_in_dir_matches_extensions_case_insensitively");
        fs::write(dir.join("LOUD.MID"), []).unwrap();
        fs::write(dir.join("soft.Midi"), []).unwrap();

        let files = list_midi_files_in_dir(&dir).unwrap();

        assert_eq!(
            file_names(&files),
            vec!["LOUD.MID".to_string(), "soft.Midi".to_string()]
        );

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn imports_and_exports_preset_json() {
        let dir = create_test_dir("imports_and_exports_preset_json");
        let path = dir.join("preset.json");
        let preset = genshin_21_key_preset();

        export_preset_file(path.to_string_lossy().to_string(), preset.clone()).unwrap();
        let imported = import_preset_file(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(imported, preset);

        fs::remove_dir_all(dir).unwrap();
    }

    fn create_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("slimekeys-{name}-{}", std::process::id()));
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file_names(paths: &[String]) -> Vec<String> {
        paths
            .iter()
            .map(|path| {
                std::path::Path::new(path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect()
    }

    fn simple_midi_bytes() -> Vec<u8> {
        vec![
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            12, 0, 0x90, 60, 64, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
        ]
    }
}
