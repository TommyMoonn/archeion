mod atomic_file;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dictionary_catalog_service =
        commands::dictionary_catalog::DictionaryCatalogService::default();
    let dictionary_download_service =
        commands::dictionary_download::DictionaryDownloadService::default();
    let dictionary_install_service =
        commands::dictionary_install::DictionaryInstallService::default();
    let dictionary_lookup_service = commands::dictionary_lookup::DictionaryLookupService;
    let import_transaction_state =
        commands::archive_import_transaction::ArchiveImportTransactionState::default();
    let import_suppressions = commands::watcher::ArchiveWatcherSuppressionOwner::default();
    let watcher_state = commands::watcher::ArchiveWatcherState::with_import_suppressions(
        import_suppressions.clone(),
    );
    let import_command_state = commands::archive_import::ArchiveImportCommandState::new(
        import_transaction_state.clone(),
        import_suppressions,
    );

    tauri::Builder::default()
        .manage(dictionary_catalog_service)
        .manage(dictionary_download_service)
        .manage(dictionary_install_service)
        .manage(dictionary_lookup_service)
        .manage(watcher_state)
        .manage(import_transaction_state)
        .manage(import_command_state)
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "archive-manager" && matches!(event, tauri::WindowEvent::Destroyed)
            {
                commands::archive::handle_archive_manager_window_destroyed(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_settings::load_app_settings,
            commands::app_settings::save_app_settings,
            commands::archive::activate_archive,
            commands::archive::create_empty_archive,
            commands::archive::focus_main_window,
            commands::archive::forget_archive,
            commands::archive::load_archive_registry,
            commands::archive::open_archive,
            commands::archive::open_archive_manager_window,
            commands::archive::rename_archive,
            commands::archive::reveal_archive,
            commands::archive_import::add_epub_files_to_archive,
            commands::archive_import_artifacts::cleanup_archive_import_artifacts,
            commands::dictionaries::list_installed_dictionaries,
            commands::dictionaries::lookup_dictionary_term,
            commands::dictionaries::load_cached_dictionary_catalog,
            commands::dictionaries::refresh_dictionary_catalog,
            commands::dictionaries::cancel_dictionary_catalog_refresh,
            commands::dictionaries::download_dictionary_catalog_package,
            commands::dictionaries::cancel_dictionary_download,
            commands::dictionaries::cleanup_verified_dictionary_download,
            commands::dictionaries::install_catalog_dictionary,
            commands::dictionaries::import_stardict_dictionary,
            commands::dictionaries::set_dictionary_enabled,
            commands::dictionaries::set_dictionary_order,
            commands::dictionaries::remove_dictionary,
            commands::dictionaries::rebuild_dictionary_index,
            commands::filesystem::create_archive_folder,
            commands::filesystem::delete_archive_epub_file,
            commands::filesystem::delete_archive_folder,
            commands::filesystem::export_archive_epub_file,
            commands::filesystem::write_annotation_export_file,
            commands::illustration_export::write_illustration_image_file,
            commands::filesystem::move_archive_epub_file,
            commands::filesystem::move_archive_folder,
            commands::filesystem::rename_archive_epub_file,
            commands::filesystem::rename_archive_folder,
            commands::filesystem::reveal_archive_folder,
            commands::epub::read_epub_file,
            commands::epub::reveal_epub_file,
            commands::epub::load_epub_cover,
            commands::epub_analysis::request_epub_diagnostics,
            commands::epub_analysis::request_epub_duplicate_analysis,
            commands::epub_cover_writeback::prepare_epub_cover_writeback,
            commands::epub_cover_writeback::write_epub_cover,
            commands::epub_writeback::clear_epub_writeback_backups,
            commands::epub_writeback::get_epub_writeback_backup_status,
            commands::epub_writeback::write_epub_metadata,
            commands::external::open_external_url,
            commands::metadata::initialize_archive_metadata,
            commands::metadata::load_archive_metadata,
            commands::metadata::load_annotations_metadata,
            commands::metadata::load_settings_metadata,
            commands::metadata::save_annotations_metadata,
            commands::metadata::save_library_metadata,
            commands::metadata::save_progress_metadata,
            commands::metadata::save_settings_metadata,
            commands::scanner::clear_scanner_cache,
            commands::scanner::invalidate_scanner_cache_entries,
            commands::scanner::scan_archive,
            commands::scanner::scan_archive_epub_paths,
            commands::themes::delete_archive_theme_package,
            commands::themes::list_archive_theme_packages,
            commands::themes::read_archive_theme_manifest,
            commands::themes::replace_archive_theme_manifest,
            commands::themes::reveal_archive_themes_folder,
            commands::themes::store_archive_theme_manifest,
            commands::archive_root::clear_cover_cache,
            commands::archive_root::invalidate_cover_cache_entries,
            commands::archive_root::maintain_cover_cache,
            commands::archive_root::cover_cache_status,
            commands::archive_root::reveal_archeion_folder,
            commands::archive_root::validate_archive_path,
            commands::watcher::start_archive_watcher,
            commands::watcher::stop_archive_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
