mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::watcher::VaultWatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::archive::activate_archive,
            commands::archive::forget_archive,
            commands::archive::load_archive_registry,
            commands::archive::open_archive,
            commands::archive::rename_archive,
            commands::archive::reveal_archive,
            commands::archive_import::add_epub_files_to_vault,
            commands::filesystem::create_vault_folder,
            commands::filesystem::delete_vault_epub_file,
            commands::filesystem::delete_vault_folder,
            commands::filesystem::move_vault_epub_file,
            commands::filesystem::move_vault_folder,
            commands::filesystem::rename_vault_epub_file,
            commands::filesystem::rename_vault_folder,
            commands::filesystem::reveal_vault_folder,
            commands::epub::read_epub_file,
            commands::epub::reveal_epub_file,
            commands::epub::load_epub_cover,
            commands::metadata::initialize_vault_metadata,
            commands::metadata::load_vault_metadata,
            commands::metadata::save_library_metadata,
            commands::metadata::save_progress_metadata,
            commands::metadata::save_settings_metadata,
            commands::scanner::scan_vault,
            commands::vault::clear_cover_cache,
            commands::vault::cover_cache_status,
            commands::vault::reveal_archeion_folder,
            commands::vault::validate_vault_path,
            commands::watcher::start_vault_watcher,
            commands::watcher::stop_vault_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
