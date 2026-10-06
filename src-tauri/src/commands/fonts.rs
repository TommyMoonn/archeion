use super::font_catalog::FontCatalog;

static INSTALLED_FONTS: FontCatalog = FontCatalog::new();

#[tauri::command]
pub async fn list_installed_font_families() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| INSTALLED_FONTS.families().to_vec())
        .await
        .map_err(|error| format!("Failed to load installed font families: {error}"))
}
