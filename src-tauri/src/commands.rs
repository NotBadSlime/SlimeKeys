use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    keyboard::{KeyboardSink, TrackedKeyboardOutput},
    midi_file::parse_midi_bytes,
    midi_input::{list_midi_input_devices, MidiInputDevice},
    model::{InputSource, KeyAction, KeyActionKind, MidiEvent, Preset},
    presets::genshin_21_key_preset,
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
    keyboard: Arc<Mutex<TrackedKeyboardOutput<PlatformKeyboardSink>>>,
    playback_cancel: Mutex<Option<Arc<AtomicBool>>>,
    live_connection: Mutex<Option<midir::MidiInputConnection<()>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            output_enabled: Arc::new(Mutex::new(false)),
            keyboard: Arc::new(Mutex::new(TrackedKeyboardOutput::new(
                platform_keyboard_sink(),
            ))),
            playback_cancel: Mutex::new(None),
            live_connection: Mutex::new(None),
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
        presets: vec![genshin_21_key_preset()],
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
    stop_existing_playback(&state)?;
    release_all(&state)?;

    let bytes = fs::read(&path).map_err(|err| format!("failed to read MIDI file: {err}"))?;
    let actions = build_file_playback_actions(&preset, &bytes, start_at_ms)?;
    let action_count = actions.len();
    let cancel = Arc::new(AtomicBool::new(false));

    *state
        .playback_cancel
        .lock()
        .map_err(|_| "playback state lock is poisoned".to_string())? = Some(cancel.clone());

    dispatch_actions(
        actions,
        state.output_enabled.clone(),
        state.keyboard.clone(),
        cancel,
    );

    Ok(action_count)
}

#[tauri::command]
pub fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    stop_existing_playback(&state)?;
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
                    dispatch_actions(
                        actions,
                        output_enabled.clone(),
                        keyboard.clone(),
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

fn stop_existing_playback(state: &State<'_, AppState>) -> Result<(), String> {
    if let Some(cancel) = state
        .playback_cancel
        .lock()
        .map_err(|_| "playback state lock is poisoned".to_string())?
        .take()
    {
        cancel.store(true, Ordering::SeqCst);
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
    output_enabled: Arc<Mutex<bool>>,
    keyboard: Arc<Mutex<TrackedKeyboardOutput<S>>>,
    cancel: Arc<AtomicBool>,
) where
    S: KeyboardSink + Send + 'static,
{
    thread::spawn(move || {
        let start = Instant::now();

        for action in actions {
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let target = start + Duration::from_millis(action.at_ms);
            let now = Instant::now();
            if target > now {
                thread::sleep(target - now);
            }

            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let enabled = output_enabled
                .lock()
                .map(|enabled| *enabled)
                .unwrap_or(false);
            if !enabled {
                continue;
            }

            if let Ok(mut keyboard) = keyboard.lock() {
                let _ = match action.kind {
                    KeyActionKind::Down => keyboard.key_down(&action.key),
                    KeyActionKind::Up => keyboard.key_up(&action.key),
                };
            }
        }

        if cancel.load(Ordering::SeqCst) {
            if let Ok(mut keyboard) = keyboard.lock() {
                let _ = keyboard.release_all();
            }
        }
    });
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
    use std::path::PathBuf;

    #[test]
    fn app_snapshot_contains_default_preset_and_no_active_output() {
        let snapshot = initial_snapshot();

        assert_eq!(snapshot.presets.len(), 1);
        assert_eq!(snapshot.presets[0].id, "genshin-21-key");
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
