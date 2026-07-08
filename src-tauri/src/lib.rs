mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::watcher::ArchiveWatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_settings::load_app_settings,
            commands::app_settings::save_app_settings,
            commands::archive::activate_archive,
            commands::archive::focus_main_window,
            commands::archive::forget_archive,
            commands::archive::load_archive_registry,
            commands::archive::open_archive,
            commands::archive::open_archive_manager_window,
            commands::archive::rename_archive,
            commands::archive::reveal_archive,
            commands::archive_import::add_epub_files_to_archive,
            commands::filesystem::create_archive_folder,
            commands::filesystem::delete_archive_epub_file,
            commands::filesystem::delete_archive_folder,
            commands::filesystem::move_archive_epub_file,
            commands::filesystem::move_archive_folder,
            commands::filesystem::rename_archive_epub_file,
            commands::filesystem::rename_archive_folder,
            commands::filesystem::reveal_archive_folder,
            commands::epub::read_epub_file,
            commands::epub::reveal_epub_file,
            commands::epub::load_epub_cover,
            commands::epub_writeback::write_epub_metadata,
            commands::metadata::initialize_archive_metadata,
            commands::metadata::load_archive_metadata,
            commands::metadata::load_settings_metadata,
            commands::metadata::save_library_metadata,
            commands::metadata::save_progress_metadata,
            commands::metadata::save_settings_metadata,
            commands::scanner::clear_scanner_cache,
            commands::scanner::scan_archive,
            commands::archive_root::clear_cover_cache,
            commands::archive_root::cover_cache_status,
            commands::archive_root::reveal_archeion_folder,
            commands::archive_root::validate_archive_path,
            commands::watcher::start_archive_watcher,
            commands::watcher::stop_archive_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
