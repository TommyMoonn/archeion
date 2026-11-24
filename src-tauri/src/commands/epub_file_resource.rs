use std::{
    fmt,
    fs::{self, File},
    io::Read,
    path::Path,
};

pub(super) const MAX_ACTIVE_EPUB_BYTES: u64 = 256 * 1024 * 1024;

fn size_limit_error() -> String {
    "This EPUB exceeds Archeion's 256 MiB reader limit.".to_string()
}

#[derive(Debug)]
pub(super) enum EpubFileResourceError {
    NotFile,
    TooLarge,
    Unavailable(String),
}

impl fmt::Display for EpubFileResourceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFile => formatter.write_str("The selected EPUB is not a file."),
            Self::TooLarge => formatter.write_str(&size_limit_error()),
            Self::Unavailable(error) => formatter.write_str(error),
        }
    }
}

pub(super) fn validate_epub_file_size(path: &Path) -> Result<u64, EpubFileResourceError> {
    let metadata = fs::metadata(path)
        .map_err(|error| EpubFileResourceError::Unavailable(error.to_string()))?;
    if !metadata.is_file() {
        return Err(EpubFileResourceError::NotFile);
    }
    if metadata.len() > MAX_ACTIVE_EPUB_BYTES {
        return Err(EpubFileResourceError::TooLarge);
    }
    Ok(metadata.len())
}

pub(super) fn read_epub_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(EpubFileResourceError::NotFile.to_string());
    }
    let declared_length = metadata.len();
    read_bounded_epub_bytes(&mut file, declared_length)
}

// External requests must still refer to the canonical local path selected at launch.
// On Windows, deny concurrent writes/deletes while the handle is open, and verify
// the actual handle target rather than trusting a second path-based lookup.
pub(super) fn read_external_epub_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let changed = || "The selected EPUB has changed since it was opened.".to_string();
    if !super::cold_start_epub::is_local_reader_path(path)
        || fs::canonicalize(path).map_err(|_| changed())? != path
    {
        return Err(changed());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ only: keep the selected file stable during the bounded read.
        options.share_mode(1);
    }
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        use std::{
            ffi::OsString,
            os::windows::{ffi::OsStringExt, io::AsRawHandle},
        };
        use windows::Win32::{
            Foundation::HANDLE,
            Storage::FileSystem::{GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED},
        };
        let mut buffer = vec![0u16; 32768];
        // SAFETY: the borrowed file handle remains open, and buffer is writable.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                HANDLE(file.as_raw_handle()),
                &mut buffer,
                FILE_NAME_NORMALIZED,
            )
        } as usize;
        if length == 0
            || length >= buffer.len()
            || Path::new(&OsString::from_wide(&buffer[..length])) != path
        {
            return Err(changed());
        }
    }
    let before = file.metadata().map_err(|error| error.to_string())?;
    if !before.is_file() {
        return Err(EpubFileResourceError::NotFile.to_string());
    }
    let bytes = read_bounded_epub_bytes(&mut file, before.len())?;
    let after = file.metadata().map_err(|error| error.to_string())?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || before.modified().ok() != after.modified().ok()
        || fs::canonicalize(path).map_err(|_| changed())? != path
    {
        return Err(changed());
    }
    Ok(bytes)
}

fn read_bounded_epub_bytes(
    reader: &mut impl Read,
    declared_length: u64,
) -> Result<Vec<u8>, String> {
    read_bounded_epub_bytes_with_limit(reader, declared_length, MAX_ACTIVE_EPUB_BYTES)
}

fn read_bounded_epub_bytes_with_limit(
    reader: &mut impl Read,
    declared_length: u64,
    maximum_bytes: u64,
) -> Result<Vec<u8>, String> {
    if declared_length > maximum_bytes {
        return Err(size_limit_error());
    }

    let capacity = usize::try_from(declared_length).map_err(|_| size_limit_error())?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(capacity)
        .map_err(|_| "Archeion could not allocate memory to open this EPUB.".to_string())?;

    let mut chunk = [0_u8; 64 * 1024];
    loop {
        let remaining = maximum_bytes.saturating_sub(bytes.len() as u64);
        if remaining == 0 {
            let mut probe = [0_u8; 1];
            return match reader.read(&mut probe).map_err(|error| error.to_string())? {
                0 => Ok(bytes),
                _ => Err(size_limit_error()),
            };
        }

        let read_length = remaining.min(chunk.len() as u64) as usize;
        let read = reader
            .read(&mut chunk[..read_length])
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(bytes);
        }
        bytes
            .try_reserve_exact(read)
            .map_err(|_| "Archeion could not allocate memory to open this EPUB.".to_string())?;
        bytes.extend_from_slice(&chunk[..read]);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File},
        io::{Cursor, Read},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        read_bounded_epub_bytes, read_bounded_epub_bytes_with_limit, read_epub_file_bytes,
        read_external_epub_bytes, MAX_ACTIVE_EPUB_BYTES,
    };

    struct ReadCounter {
        reads: usize,
    }

    impl Read for ReadCounter {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads += 1;
            Ok(0)
        }
    }

    struct ChunkedReadCounter {
        inner: Cursor<Vec<u8>>,
        reads: usize,
    }

    impl Read for ChunkedReadCounter {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads += 1;
            self.inner.read(buffer)
        }
    }

    #[test]
    fn reads_a_bounded_epub_without_changing_its_bytes() {
        let expected = b"PK\x03\x04reader".to_vec();
        let mut reader = Cursor::new(expected.clone());

        let bytes = read_bounded_epub_bytes(&mut reader, expected.len() as u64)
            .expect("bounded EPUB should load");

        assert_eq!(bytes, expected);
    }

    #[test]
    fn preserves_an_empty_epub_read_result() {
        let mut reader = Cursor::new(Vec::<u8>::new());

        let bytes =
            read_bounded_epub_bytes(&mut reader, 0).expect("empty stream should be bounded");

        assert!(bytes.is_empty());
    }

    #[test]
    fn rejects_an_oversized_declared_file_before_reading() {
        let mut reader = ReadCounter { reads: 0 };

        let error = read_bounded_epub_bytes(&mut reader, MAX_ACTIVE_EPUB_BYTES + 1)
            .expect_err("oversized EPUB should be rejected");

        assert_eq!(error, "This EPUB exceeds Archeion's 256 MiB reader limit.");
        assert_eq!(reader.reads, 0);
    }

    #[test]
    fn rejects_an_oversized_file_from_the_production_path_before_allocating_its_length() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "archeion-oversized-reader-{}-{unique}.epub",
            std::process::id()
        ));
        let file = File::create(&path).expect("sparse test file should be created");
        file.set_len(MAX_ACTIVE_EPUB_BYTES + 1)
            .expect("sparse test file should declare an oversized length");
        drop(file);

        let result = read_epub_file_bytes(&path);
        fs::remove_file(&path).expect("sparse test file should be removed");

        assert_eq!(
            result.expect_err("oversized EPUB should be rejected"),
            "This EPUB exceeds Archeion's 256 MiB reader limit."
        );
    }

    #[test]
    fn rejects_a_stream_that_exceeds_the_configured_bound_after_a_small_declaration() {
        let mut reader = std::io::repeat(1).take(9);

        let error = read_bounded_epub_bytes_with_limit(&mut reader, 0, 8)
            .expect_err("changing oversized stream should be rejected");

        assert_eq!(error, "This EPUB exceeds Archeion's 256 MiB reader limit.");
    }

    #[test]
    fn external_reads_reject_deleted_or_redirected_paths() {
        let root = std::env::temp_dir().join(format!(
            "archeion-external-read-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("A 日本語.epub");
        fs::write(&path, b"selected bytes").unwrap();
        let canonical = fs::canonicalize(&path).unwrap();
        assert_eq!(
            read_external_epub_bytes(&canonical).unwrap(),
            b"selected bytes"
        );
        fs::remove_file(&path).unwrap();
        assert!(read_external_epub_bytes(&canonical).is_err());
        let other = root.join("other.epub");
        fs::write(&other, b"other bytes").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&other, &path).unwrap();
            assert!(read_external_epub_bytes(&canonical).is_err());
        }
        #[cfg(windows)]
        {
            // Symlink creation requires Developer Mode or an elevated token on
            // Windows. Do not fail the ordinary suite when it is unavailable.
            if std::os::windows::fs::symlink_file(&other, &path).is_ok() {
                assert!(read_external_epub_bytes(&canonical).is_err());
            }
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn records_bounded_chunk_and_probe_work_for_a_representative_epub_read() {
        const FIXTURE_BYTES: usize = 128 * 1024;
        let expected = vec![7_u8; FIXTURE_BYTES];
        let mut reader = ChunkedReadCounter {
            inner: Cursor::new(expected.clone()),
            reads: 0,
        };

        let bytes = read_bounded_epub_bytes_with_limit(
            &mut reader,
            FIXTURE_BYTES as u64,
            FIXTURE_BYTES as u64,
        )
        .expect("bounded fixture should load");

        assert_eq!(bytes, expected);
        assert_eq!(reader.reads, 3);
    }
}
