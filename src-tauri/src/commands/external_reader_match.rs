use std::{
    fs::{self, File},
    io::Read,
    path::Path,
};

use super::{filesystem::normalize_archive_relative_path, metadata::LibraryMetadata};

const MAX_LIBRARY_METADATA_BYTES: u64 = 16 * 1024 * 1024;

fn path_key(path: &Path) -> String {
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        path.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.into_owned()
    }
}

fn read_library_snapshot(root: &Path) -> Option<LibraryMetadata> {
    let path = root.join(".archeion").join("library.json");
    let mut file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_LIBRARY_METADATA_BYTES {
        return None;
    }
    // The metadata may grow between stat and read. Bound the actual read too.
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_LIBRARY_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_LIBRARY_METADATA_BYTES {
        return None;
    }
    let library: LibraryMetadata = serde_json::from_slice(&bytes).ok()?;
    (library.version == 1).then_some(library)
}

// A path-identity match is deliberately stricter than library rescan identity
// reconciliation. Never infer a managed session from title, author, or EPUB ID.
#[derive(Debug)]
pub(super) struct MatchedArchiveBook {
    pub book_id: String,
    pub relative_path: String,
}

pub(super) fn match_active_archive_book(
    root: &Path,
    selected: &Path,
) -> Option<MatchedArchiveBook> {
    let selected = fs::canonicalize(selected).ok()?;
    if !selected.is_file()
        || !selected
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"))
    {
        return None;
    }
    let root = fs::canonicalize(root).ok()?;
    let relative = selected.strip_prefix(&root).ok()?;
    let selected_key = path_key(&selected);
    let relative_key = path_key(relative);
    let library = read_library_snapshot(&root)?;
    let mut match_id = None;

    for (book_id, record) in library.books {
        let Ok(path) = normalize_archive_relative_path(&record.relative_path) else {
            continue;
        };
        if path_key(Path::new(&path)) != relative_key {
            continue;
        }
        // Prevent returning an ID for a stale or redirected archive record.
        let Ok(record_path) = fs::canonicalize(root.join(&path)) else {
            continue;
        };
        if path_key(&record_path) != selected_key {
            continue;
        }
        if match_id.is_some() {
            return None;
        }
        match_id = Some(MatchedArchiveBook {
            book_id,
            relative_path: path,
        });
    }

    match_id
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;
    use crate::commands::metadata::LibraryBookMetadata;

    struct ArchiveFixture(PathBuf);

    impl ArchiveFixture {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "archeion-external-match-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(root.join(".archeion")).unwrap();
            Self(root)
        }

        fn book(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"EPUB test").unwrap();
            path
        }

        fn library(&self, records: &[(&str, &str)]) {
            let books = records
                .iter()
                .map(|(id, path)| {
                    (
                        (*id).to_string(),
                        LibraryBookMetadata {
                            relative_path: (*path).to_string(),
                            is_favorite: false,
                            reader_presentation: None,
                            cover_path: None,
                            source_metadata: None,
                            file_size: None,
                            file_modified_at: None,
                            added_at: None,
                            updated_at: "2026-01-01".to_string(),
                        },
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let bytes = serde_json::to_vec(&LibraryMetadata { version: 1, books }).unwrap();
            fs::write(self.0.join(".archeion/library.json"), bytes).unwrap();
        }

        fn root(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ArchiveFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn resolves_exact_tracked_path_without_considering_book_metadata() {
        let archive = ArchiveFixture::new();
        let selected = archive.book("Books/A 日本語.epub");
        archive.library(&[("stable-book-id", "Books/A 日本語.epub")]);
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            Some("stable-book-id".into())
        );
    }

    #[test]
    fn does_not_match_untracked_files_or_books_in_another_archive() {
        let active = ArchiveFixture::new();
        let remembered = ArchiveFixture::new();
        let active_file = active.book("Books/Same title.epub");
        let other_file = remembered.book("Books/Same title.epub");
        active.library(&[("active-id", "Books/Same title.epub")]);
        remembered.library(&[("other-id", "Books/Same title.epub")]);
        assert_eq!(
            match_active_archive_book(active.root(), &active_file).map(|matched| matched.book_id),
            Some("active-id".into())
        );
        assert_eq!(
            match_active_archive_book(active.root(), &other_file).map(|matched| matched.book_id),
            None
        );
        let untracked = active.book("Books/Untracked.epub");
        assert_eq!(
            match_active_archive_book(active.root(), &untracked).map(|matched| matched.book_id),
            None
        );
    }

    #[test]
    fn duplicate_paths_are_ambiguous_and_never_resolve_to_managed_state() {
        let archive = ArchiveFixture::new();
        let selected = archive.book("Books/Duplicate.epub");
        archive.library(&[("a", "Books/Duplicate.epub"), ("b", "Books/Duplicate.epub")]);
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
    }

    #[test]
    fn inaccessible_invalid_and_unavailable_metadata_fall_back_to_temporary() {
        let archive = ArchiveFixture::new();
        let selected = archive.book("Books/Tracked.epub");
        archive.library(&[("id", "Books/Tracked.epub")]);
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            Some("id".into())
        );
        fs::remove_file(&selected).unwrap();
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
        fs::write(&selected, b"EPUB test").unwrap();
        fs::write(archive.root().join(".archeion/library.json"), b"invalid").unwrap();
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
        fs::remove_file(archive.root().join(".archeion/library.json")).unwrap();
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
    }

    #[test]
    fn rejects_traversal_and_oversized_library_metadata_without_side_effects() {
        let archive = ArchiveFixture::new();
        let selected = archive.book("Books/Tracked.epub");
        archive.library(&[("unsafe", "../Books/Tracked.epub")]);
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
        let metadata = archive.root().join(".archeion/library.json");
        fs::File::create(&metadata)
            .unwrap()
            .set_len(MAX_LIBRARY_METADATA_BYTES + 1)
            .unwrap();
        assert_eq!(
            match_active_archive_book(archive.root(), &selected).map(|matched| matched.book_id),
            None
        );
    }
}
