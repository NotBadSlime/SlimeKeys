use std::{fs, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    keyboard::TrackedKeyboardOutput,
    midi_file::parse_midi_bytes,
    midi_input::{list_midi_input_devices, MidiInputDevice},
    model::{MidiEvent, Preset},
    presets::genshin_21_key_preset,
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
    output_enabled: Mutex<bool>,
    keyboard: Mutex<TrackedKeyboardOutput<PlatformKeyboardSink>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            output_enabled: Mutex::new(false),
            keyboard: Mutex::new(TrackedKeyboardOutput::new(platform_keyboard_sink())),
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
    state
        .keyboard
        .lock()
        .map_err(|_| "keyboard state lock is poisoned".to_string())?
        .release_all()
        .map_err(|err| err.to_string())
}

#[cfg(windows)]
fn platform_keyboard_sink() -> PlatformKeyboardSink {
    WindowsKeyboardSink
}

#[cfg(not(windows))]
fn platform_keyboard_sink() -> PlatformKeyboardSink {
    NoopKeyboardSink
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_snapshot_contains_default_preset_and_no_active_output() {
        let snapshot = initial_snapshot();

        assert_eq!(snapshot.presets.len(), 1);
        assert_eq!(snapshot.presets[0].id, "genshin-21-key");
        assert!(!snapshot.output_enabled);
    }
}
