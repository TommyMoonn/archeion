mod archive;
mod cover_document;
mod fingerprint;
mod image;
mod package;
mod service;
mod types;
mod xml;

pub use self::types::{
    EpubCoverPreparation, EpubCoverPreparationInput, EpubCoverWritebackInput,
    EpubCoverWritebackResult,
};

use self::service::{prepare_cover_writeback_at, write_cover_at};
use super::archive_root;

#[tauri::command]
pub async fn prepare_epub_cover_writeback(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubCoverPreparationInput,
) -> Result<EpubCoverPreparation, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || prepare_cover_writeback_at(&root, &input))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_epub_cover(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubCoverWritebackInput,
) -> Result<EpubCoverWritebackResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || write_cover_at(&root, input))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
