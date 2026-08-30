pub mod commands;
pub mod keyboard;
pub mod midi_file;
pub mod midi_input;
pub mod audio_output;
pub mod audition_engine;
pub mod midi_output;
pub mod model;
pub mod passthrough_hotkeys;
pub mod playback_clock;
pub mod presets;
pub mod rule_engine;

use commands::{
    clear_passthrough_hotkeys, export_preset_file, get_app_snapshot, import_preset_file,
    list_audio_outputs, list_midi_files_near, list_midi_inputs, list_midi_outputs,
    panic_release_all_keys, parse_midi_file, play_midi_events_from, play_midi_file,
    play_midi_file_from, set_audition_enabled, set_output_enabled, set_passthrough_hotkeys,
    set_playback_speed, set_playback_tracks, start_live_input, stop_live_input, stop_playback,
    AppState,
};

#[tauri::command]
fn ping() -> &'static str {
    "slimekeys-ready"
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_app_snapshot,
            list_midi_inputs,
            list_midi_outputs,
            list_audio_outputs,
            list_midi_files_near,
            set_passthrough_hotkeys,
            clear_passthrough_hotkeys,
            import_preset_file,
            export_preset_file,
            parse_midi_file,
            play_midi_events_from,
            play_midi_file,
            play_midi_file_from,
            stop_playback,
            set_output_enabled,
            set_audition_enabled,
            set_playback_speed,
            set_playback_tracks,
            panic_release_all_keys,
            start_live_input,
            stop_live_input
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SlimeKeys");
}
