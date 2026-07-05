use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use super::vault;

fn resolve_epub_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("EPUB paths must be relative to the library folder.".to_string());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("The EPUB path is outside the library folder.".to_string());
    }
    if relative
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == ".archeion")
    {
        return Err("App metadata cannot be opened as an EPUB.".to_string());
    }
    let is_epub = relative
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"));
    if !is_epub {
        return Err("The selected file is not an EPUB.".to_string());
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path =
        fs::canonicalize(canonical_root.join(relative)).map_err(|error| error.to_string())?;
    if !path.starts_with(&canonical_root) || !path.is_file() {
        return Err("The EPUB file is outside the library folder.".to_string());
    }

    Ok(path)
}

#[tauri::command]
pub fn read_epub_file(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let root = vault::read_vault_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No library folder has been selected.".to_string())?;
    let path = resolve_epub_path(&root, &relative_path)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::resolve_epub_path;

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-{nonce}"))
    }

    #[test]
    fn resolves_epubs_inside_the_vault() {
        let root = test_root();
        let book = root.join("Series").join("Volume.epub");
        fs::create_dir_all(book.parent().expect("book should have a parent"))
            .expect("series should be created");
        fs::write(&book, b"epub").expect("EPUB should be created");

        let resolved = resolve_epub_path(&root, "Series/Volume.epub").expect("EPUB should resolve");

        assert_eq!(
            resolved,
            fs::canonicalize(&book).expect("book path should canonicalize")
        );
        fs::remove_dir_all(root).expect("test vault should be removed");
    }

    #[test]
    fn rejects_traversal_metadata_and_non_epub_paths() {
        let root = test_root();
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join(".archeion").join("hidden.epub"), b"hidden")
            .expect("metadata file should be created");
        fs::write(root.join("notes.txt"), b"notes").expect("text file should be created");

        assert!(resolve_epub_path(&root, "../outside.epub").is_err());
        assert!(resolve_epub_path(&root, ".archeion/hidden.epub").is_err());
        assert!(resolve_epub_path(&root, "notes.txt").is_err());
        assert!(resolve_epub_path(&root, "missing.epub").is_err());
        fs::remove_dir_all(root).expect("test vault should be removed");
    }
}
