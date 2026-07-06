use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
const RESERVED_ITEM_NAME_CHARS: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

pub(crate) fn path_relative_to(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

pub(crate) fn is_reserved_archive_path(relative_path: &str) -> bool {
    relative_path
        .replace('\\', "/")
        .split('/')
        .find(|part| !part.is_empty())
        .is_some_and(|part| part.eq_ignore_ascii_case(METADATA_DIRECTORY))
}

pub(crate) fn normalize_archive_relative_path(relative_path: &str) -> Result<String, String> {
    let normalized_input = relative_path.replace('\\', "/");
    let path = Path::new(&normalized_input);
    if path.is_absolute() {
        return Err("Archive paths must be relative to the library folder.".to_string());
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().trim().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Archive paths cannot leave the library folder.".to_string());
            }
        }
    }

    parts.retain(|part| !part.is_empty());
    if parts.is_empty() {
        return Err("Archive paths cannot be empty.".to_string());
    }
    let normalized = parts.join("/");
    if is_reserved_archive_path(&normalized) {
        return Err("The .archeion metadata folder is reserved.".to_string());
    }
    Ok(normalized)
}

fn is_windows_reserved_name(name: &str) -> bool {
    matches!(
        name.split('.').next().unwrap_or_default().to_ascii_lowercase().as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

pub(crate) fn validate_archive_item_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Names cannot be empty.".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Names cannot use path traversal segments.".to_string());
    }
    if trimmed
        .chars()
        .any(|character| RESERVED_ITEM_NAME_CHARS.contains(&character))
    {
        return Err("Names cannot contain path separators or reserved characters.".to_string());
    }
    if trimmed.ends_with(' ') || trimmed.ends_with('.') {
        return Err("Names cannot end with a space or period.".to_string());
    }
    if trimmed.eq_ignore_ascii_case(METADATA_DIRECTORY) {
        return Err("The .archeion metadata folder is reserved.".to_string());
    }
    if is_windows_reserved_name(trimmed) {
        return Err("This name is reserved by Windows.".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn validate_epub_file_name(name: &str) -> Result<String, String> {
    let trimmed = validate_archive_item_name(name)?;
    if !trimmed.to_ascii_lowercase().ends_with(".epub") {
        return Err("EPUB file names must end with .epub.".to_string());
    }
    Ok(trimmed)
}

pub(crate) fn resolve_existing_archive_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative_path = normalize_archive_relative_path(relative_path)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let resolved = fs::canonicalize(canonical_root.join(relative_path))
        .map_err(|error| error.to_string())?;
    if !resolved.starts_with(&canonical_root) {
        return Err("The selected path is outside the library folder.".to_string());
    }
    Ok(resolved)
}

pub(crate) fn resolve_existing_epub_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_archive_relative_path(relative_path)?;
    let file_name = Path::new(&normalized)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The selected EPUB file is unavailable.".to_string())?;
    validate_epub_file_name(file_name)?;
    let resolved = resolve_existing_archive_path(root, &normalized)?;
    if !resolved.is_file() {
        return Err("The selected EPUB file is unavailable.".to_string());
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        is_reserved_archive_path, normalize_archive_relative_path, resolve_existing_epub_path,
        validate_archive_item_name, validate_epub_file_name,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-filesystem-{nonce}"))
    }

    #[test]
    fn normalizes_archive_relative_paths() {
        assert_eq!(
            normalize_archive_relative_path("Author\\Series/./Volume.epub")
                .expect("path should normalize"),
            "Author/Series/Volume.epub"
        );
        assert!(normalize_archive_relative_path("../outside.epub").is_err());
        assert!(normalize_archive_relative_path(".archeion/library.json").is_err());
        assert!(is_reserved_archive_path(".archeion/covers/book.cover"));
    }

    #[test]
    fn validates_file_and_folder_names() {
        assert_eq!(
            validate_archive_item_name("Series").expect("name should be valid"),
            "Series"
        );
        assert_eq!(
            validate_epub_file_name("Volume.EPUB").expect("EPUB name should be valid"),
            "Volume.EPUB"
        );
        assert!(validate_archive_item_name("CON").is_err());
        assert!(validate_archive_item_name("bad/name").is_err());
        assert!(validate_archive_item_name("name.").is_err());
        assert!(validate_epub_file_name("notes.txt").is_err());
    }

    #[test]
    fn resolves_only_epubs_inside_the_archive() {
        let root = test_root();
        let book = root.join("Series").join("Volume.epub");
        fs::create_dir_all(book.parent().expect("book should have a parent"))
            .expect("series should be created");
        fs::write(&book, b"epub").expect("EPUB should be created");
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join(".archeion").join("hidden.epub"), b"hidden")
            .expect("metadata EPUB should be created");

        assert_eq!(
            resolve_existing_epub_path(&root, "Series/Volume.epub")
                .expect("EPUB should resolve"),
            fs::canonicalize(&book).expect("book path should canonicalize")
        );
        assert!(resolve_existing_epub_path(&root, ".archeion/hidden.epub").is_err());
        assert!(resolve_existing_epub_path(&root, "../outside.epub").is_err());
        assert!(resolve_existing_epub_path(&root, "missing.epub").is_err());
        fs::remove_dir_all(root).expect("test vault should be removed");
    }
}
