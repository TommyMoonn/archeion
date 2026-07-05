mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::vault::load_vault_path,
            commands::vault::save_vault_path,
            commands::vault::validate_vault_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
