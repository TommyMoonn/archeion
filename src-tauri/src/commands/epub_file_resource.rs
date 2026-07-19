use std::{fs::File, io::Read, path::Path};

pub(super) const MAX_ACTIVE_EPUB_BYTES: u64 = 256 * 1024 * 1024;

fn size_limit_error() -> String {
    "This EPUB exceeds Archeion's 256 MiB reader limit.".to_string()
}

pub(super) fn read_epub_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let declared_length = file.metadata().map_err(|error| error.to_string())?.len();
    read_bounded_epub_bytes(&mut file, declared_length)
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
        MAX_ACTIVE_EPUB_BYTES,
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
    fn rejects_a_stream_that_grows_beyond_its_declared_length() {
        let mut reader = std::io::repeat(1).take(9);

        let error = read_bounded_epub_bytes_with_limit(&mut reader, 0, 8)
            .expect_err("changing oversized stream should be rejected");

        assert_eq!(error, "This EPUB exceeds Archeion's 256 MiB reader limit.");
    }
}
