use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct ColdStartEpub(pub Option<String>);

#[tauri::command]
pub fn cold_start_epub(
    window: tauri::WebviewWindow,
    readers: tauri::State<'_, super::external_reader::ExternalReaderRegistry>,
) -> Option<super::external_reader::ExternalReaderRequest> {
    readers.request_for_window(window.label())
}

pub fn resolve_cold_start_epub(args: impl IntoIterator<Item = OsString>) -> Option<String> {
    resolve_cold_start_epub_in(args, None)
}

pub fn resolve_cold_start_epub_in(
    args: impl IntoIterator<Item = OsString>,
    cwd: Option<&Path>,
) -> Option<String> {
    let mut args = args.into_iter();
    let first = args.next()?;
    let candidate = if first == "--open-epub" {
        args.next()?
    } else {
        first
    };
    if args.next().is_some() {
        return None;
    }

    let raw = candidate.to_str()?;
    let input = raw
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(raw);
    if input.is_empty() || input.starts_with('-') {
        return None;
    }

    let path = if input
        .split_once(':')
        .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case("file"))
    {
        let url = tauri::Url::parse(input).ok()?;
        if url.query().is_some()
            || url.fragment().is_some()
            || url
                .host_str()
                .is_some_and(|host| !host.eq_ignore_ascii_case("localhost"))
        {
            return None;
        }
        url.to_file_path().ok()?
    } else {
        if input.contains("://") {
            return None;
        }
        let path = PathBuf::from(input);
        if path.is_absolute() {
            path
        } else if let Some(cwd) = cwd {
            cwd.join(path)
        } else {
            path
        }
    };

    let path = std::path::absolute(path).ok()?;
    if !is_local_reader_path(&path)
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
        || !fs::metadata(&path).ok()?.is_file()
    {
        return None;
    }

    let canonical = fs::canonicalize(path).ok()?;
    if !is_local_reader_path(&canonical)
        || !canonical
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
    {
        return None;
    }
    canonical.to_str().map(str::to_owned)
}

// Reject UNC/device paths and mapped remote drives before touching the filesystem.
// A canonical path is checked again to catch local junctions to remote targets.
pub(super) fn is_local_reader_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDriveTypeW};
        let Some(Component::Prefix(prefix)) = path.components().next() else {
            return false;
        };
        let drive = match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return false,
        };
        let root = [u16::from(drive), b':' as u16, b'\\' as u16, 0];
        // SAFETY: root is a NUL-terminated UTF-16 drive root.
        matches!(
            unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) },
            2 | 3 | 5 | 6
        )
    }
    #[cfg(not(windows))]
    {
        path.is_absolute()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn with_file(f: impl FnOnce(&Path)) {
        let directory = std::env::temp_dir().join(format!(
            "archeion-cold-launch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("A book 日本語.epub");
        fs::write(&path, b"test").unwrap();
        f(&path);
        fs::remove_dir_all(directory).unwrap();
    }

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn accepts_installed_launch_and_explicit_development_launch() {
        with_file(|path| {
            let expected = fs::canonicalize(path).unwrap().to_str().unwrap().to_owned();
            let raw = path.to_str().unwrap();
            assert_eq!(
                resolve_cold_start_epub(args(&[raw])),
                Some(expected.clone())
            );
            assert_eq!(
                resolve_cold_start_epub(args(&["--open-epub", raw])),
                Some(expected.clone())
            );
            assert_eq!(
                resolve_cold_start_epub(args(&[&format!("\"{raw}\"")])),
                Some(expected)
            );
        });
    }

    #[test]
    fn accepts_file_urls_with_encoded_spaces_and_unicode() {
        with_file(|path| {
            let url = tauri::Url::from_file_path(path).unwrap().to_string();
            assert_eq!(
                resolve_cold_start_epub(args(&[&url])),
                fs::canonicalize(path).unwrap().to_str().map(str::to_owned)
            );
        });
    }

    #[test]
    fn resolves_relative_warm_launch_paths_against_the_second_process_directory() {
        with_file(|path| {
            let relative = path.file_name().unwrap().to_str().unwrap();
            let result = resolve_cold_start_epub_in(args(&[relative]), path.parent());
            assert_eq!(
                result,
                fs::canonicalize(path).unwrap().to_str().map(str::to_owned)
            );
        });
    }

    #[cfg(windows)]
    #[test]
    fn rejects_unc_and_device_paths_without_accessing_the_share() {
        for path in [
            r"\\server\share\book.epub",
            r"\\?\UNC\server\share\book.epub",
            r"\\.\C:\book.epub",
        ] {
            assert!(!is_local_reader_path(Path::new(path)));
            assert_eq!(resolve_cold_start_epub(args(&[path])), None);
        }
    }

    #[test]
    fn ignores_invalid_and_unrelated_requests() {
        with_file(|path| {
            let raw = path.to_str().unwrap();
            let missing = path.with_file_name("missing.epub");
            let directory = path.parent().unwrap().to_str().unwrap();
            let not_epub = path.with_extension("txt");
            fs::write(&not_epub, b"test").unwrap();
            for values in [
                args(&[]),
                args(&["--unknown", raw]),
                args(&["--open-epub"]),
                args(&[raw, raw]),
                args(&[directory]),
                args(&[missing.to_str().unwrap()]),
                args(&[not_epub.to_str().unwrap()]),
                args(&["https://example.com/book.epub"]),
                args(&["app://local/book.epub"]),
                args(&["file:///tmp/test.epub?download=1"]),
                args(&["file:///invalid%zz.epub"]),
                args(&["file://server/share/book.epub"]),
            ] {
                assert_eq!(resolve_cold_start_epub(values), None);
            }
        });
    }
}
