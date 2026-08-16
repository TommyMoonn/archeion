use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    extract_catalog_package, extract_tar_archive, extract_tar_xz_archive, ArchiveLimits,
    DictionaryArchiveError, TAR_BLOCK_BYTES,
};
use crate::commands::dictionary_catalog::DictionaryCatalogPackageFormat;

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "archeion-dictionary-archive-{label}-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Clone)]
struct TarEntry {
    path: String,
    type_flag: u8,
    bytes: Vec<u8>,
}

impl TarEntry {
    fn file(path: impl Into<String>, bytes: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            type_flag: b'0',
            bytes: bytes.into(),
        }
    }

    fn directory(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            type_flag: b'5',
            bytes: Vec::new(),
        }
    }

    fn special(path: impl Into<String>, type_flag: u8) -> Self {
        Self {
            path: path.into(),
            type_flag,
            bytes: Vec::new(),
        }
    }
}

const FREEDICT_SHAPE_TAR_XZ: &[u8] =
    include_bytes!("fixtures/dictionary/freedict-stardict-shape.tar.xz");
const XZ_128M_DICTIONARY: &[u8] = include_bytes!("fixtures/dictionary/xz-128m-dictionary.tar.xz");

pub(crate) fn freedict_style_tar_xz_fixture() -> &'static [u8] {
    FREEDICT_SHAPE_TAR_XZ
}

fn build_tar(entries: &[TarEntry]) -> Vec<u8> {
    let mut tar = Vec::new();
    for entry in entries {
        let mut header = [0_u8; TAR_BLOCK_BYTES as usize];
        assert!(entry.path.len() <= 100);
        header[..entry.path.len()].copy_from_slice(entry.path.as_bytes());
        write_octal(&mut header[100..108], 0o644);
        write_octal(&mut header[108..116], 0);
        write_octal(&mut header[116..124], 0);
        write_octal(&mut header[124..136], entry.bytes.len() as u64);
        write_octal(&mut header[136..148], 0);
        header[148..156].fill(b' ');
        header[156] = entry.type_flag;
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let checksum = header.iter().map(|byte| *byte as u64).sum::<u64>();
        let encoded = format!("{checksum:06o}\0 ");
        header[148..156].copy_from_slice(encoded.as_bytes());
        tar.extend_from_slice(&header);
        tar.extend_from_slice(&entry.bytes);
        let padding = (TAR_BLOCK_BYTES as usize - (entry.bytes.len() % TAR_BLOCK_BYTES as usize))
            % TAR_BLOCK_BYTES as usize;
        tar.extend(std::iter::repeat_n(0, padding));
    }
    tar.extend(std::iter::repeat_n(0, TAR_BLOCK_BYTES as usize * 2));
    tar
}

fn write_octal(field: &mut [u8], value: u64) {
    let text = format!("{value:0width$o}", width = field.len() - 1);
    assert_eq!(text.len(), field.len() - 1);
    let value_len = field.len() - 1;
    field[..value_len].copy_from_slice(text.as_bytes());
    field[value_len] = 0;
}

fn extract_raw_tar(
    directory: &TestDirectory,
    entries: &[TarEntry],
    limits: ArchiveLimits,
) -> Result<(), DictionaryArchiveError> {
    let tar_path = directory.path().join("fixture.tar");
    fs::write(&tar_path, build_tar(entries)).unwrap();
    let destination = directory.path().join("extract");
    extract_tar_archive(&tar_path, &destination, limits).map(|_| ())
}

#[test]
fn freedict_style_tar_xz_normalizes_gzip_index_and_uses_current_validator() {
    let directory = TestDirectory::new("valid");
    let archive = directory.path().join("fixture.stardict.tar.xz");
    fs::write(&archive, freedict_style_tar_xz_fixture()).unwrap();
    let destination = directory.path().join("extract");

    let validated = extract_catalog_package(
        DictionaryCatalogPackageFormat::StardictTarXz,
        &archive,
        &destination,
    )
    .unwrap();

    assert_eq!(validated.package_name, "fixture");
    assert_eq!(validated.entries.len(), 2);
    assert_eq!(validated.metadata.book_name, "FreeDict-shaped Fixture");
    assert!(destination.join("fixture/fixture.idx").is_file());
    assert!(!destination.join("fixture/fixture.idx.gz").exists());
    assert!(!destination.join("fixture/README").exists());
    assert!(!destination.join("fixture/COPYING.txt").exists());
}

#[test]
fn unsafe_tar_paths_are_rejected_before_extraction() {
    for (label, path) in [
        ("absolute", "/outside.ifo"),
        ("parent", "../outside.ifo"),
        ("nested", "package/nested/fixture.ifo"),
        ("windows", "C:/outside.ifo"),
    ] {
        let directory = TestDirectory::new(label);
        let result = extract_raw_tar(
            &directory,
            &[TarEntry::file(path, b"unsafe".to_vec())],
            ArchiveLimits::production(),
        );
        assert!(matches!(
            result,
            Err(DictionaryArchiveError::InvalidArchive(_))
        ));
        assert!(!directory.path().join("outside.ifo").exists());
    }
}

#[test]
fn tar_links_and_special_entries_are_rejected() {
    for type_flag in [b'1', b'2', b'3', b'4', b'6', b'x', b'g', b'L'] {
        let directory = TestDirectory::new("special");
        let result = extract_raw_tar(
            &directory,
            &[TarEntry::special("fixture/link", type_flag)],
            ArchiveLimits::production(),
        );
        assert!(matches!(
            result,
            Err(DictionaryArchiveError::InvalidArchive(_))
        ));
    }
}

#[test]
fn tar_entry_count_and_expanded_bytes_are_bounded() {
    let count_directory = TestDirectory::new("count-limit");
    let count_limits = ArchiveLimits {
        max_entries: 2,
        max_expanded_bytes: 1024,
        max_tar_stream_bytes: 4096,
        ..ArchiveLimits::production()
    };
    let count_result = extract_raw_tar(
        &count_directory,
        &[
            TarEntry::directory("one"),
            TarEntry::directory("two"),
            TarEntry::directory("three"),
        ],
        count_limits,
    );
    assert!(matches!(
        count_result,
        Err(DictionaryArchiveError::InvalidArchive(message)) if message.contains("too many")
    ));

    let size_directory = TestDirectory::new("size-limit");
    let size_limits = ArchiveLimits {
        max_entries: 16,
        max_expanded_bytes: 4,
        max_tar_stream_bytes: 4096,
        ..ArchiveLimits::production()
    };
    let size_result = extract_raw_tar(
        &size_directory,
        &[TarEntry::file("fixture.dict", b"12345".to_vec())],
        size_limits,
    );
    assert!(matches!(
        size_result,
        Err(DictionaryArchiveError::InvalidArchive(message)) if message.contains("expanded")
    ));
}

#[test]
fn corrupt_xz_and_truncated_tar_are_contained_errors() {
    let xz_directory = TestDirectory::new("corrupt-xz");
    let archive = xz_directory.path().join("corrupt.stardict.tar.xz");
    fs::write(&archive, b"not-an-xz-stream").unwrap();
    let xz_result = extract_catalog_package(
        DictionaryCatalogPackageFormat::StardictTarXz,
        &archive,
        &xz_directory.path().join("extract"),
    );
    assert!(matches!(
        xz_result,
        Err(DictionaryArchiveError::InvalidArchive(message)) if message.contains("XZ stream")
    ));

    let tar_directory = TestDirectory::new("truncated-tar");
    let tar_path = tar_directory.path().join("truncated.tar");
    fs::write(&tar_path, [0_u8; 100]).unwrap();
    let tar_result = extract_tar_archive(
        &tar_path,
        &tar_directory.path().join("extract"),
        ArchiveLimits::production(),
    );
    assert!(matches!(
        tar_result,
        Err(DictionaryArchiveError::InvalidArchive(message)) if message.contains("truncated")
    ));
}

#[test]
fn xz_decoder_memory_limit_rejects_large_history_without_large_test_allocation() {
    assert!(XZ_128M_DICTIONARY.len() < 1024);
    let directory = TestDirectory::new("xz-memory-limit");
    let archive = directory.path().join("large-dictionary.stardict.tar.xz");
    fs::write(&archive, XZ_128M_DICTIONARY).unwrap();

    let result = extract_tar_xz_archive(
        &archive,
        &directory.path().join("extract"),
        ArchiveLimits::production(),
    );

    assert!(matches!(
        result,
        Err(DictionaryArchiveError::InvalidArchive(message))
            if message.contains("decoder memory")
    ));
}

#[test]
fn decompressed_tar_stream_limit_still_rejects_excessive_output() {
    let directory = TestDirectory::new("xz-output-limit");
    let archive = directory.path().join("fixture.stardict.tar.xz");
    fs::write(&archive, FREEDICT_SHAPE_TAR_XZ).unwrap();
    let limits = ArchiveLimits {
        max_tar_stream_bytes: 1024,
        ..ArchiveLimits::production()
    };

    let result = extract_tar_xz_archive(&archive, &directory.path().join("extract"), limits);

    assert!(matches!(
        result,
        Err(DictionaryArchiveError::InvalidArchive(message)) if message.contains("size limit")
    ));
}
