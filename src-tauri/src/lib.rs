pub mod model;
pub mod presets;
pub mod rule_engine;

#[tauri::command]
fn ping() -> &'static str {
    "slimekeys-ready"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("failed to run SlimeKeys");
}
