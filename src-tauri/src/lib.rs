pub mod model;
pub mod commands;
pub mod keyboard;
pub mod midi_file;
pub mod midi_input;
pub mod presets;
pub mod rule_engine;

use commands::{
    get_app_snapshot, list_midi_inputs, panic_release_all_keys, parse_midi_file, play_midi_file,
    set_output_enabled, start_live_input, stop_live_input, stop_playback, AppState,
};

#[tauri::command]
fn ping() -> &'static str {
    "slimekeys-ready"
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            get_app_snapshot,
            list_midi_inputs,
            parse_midi_file,
            play_midi_file,
            stop_playback,
            set_output_enabled,
            panic_release_all_keys,
            start_live_input,
            stop_live_input
        ])
        .run(tauri::generate_context!())
        .expect("failed to run SlimeKeys");
}
