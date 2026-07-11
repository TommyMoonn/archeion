use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use ::image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

use super::super::{plan_cover_package, CoverImageFormat, CoverPackagePlan};

pub(super) static SCANNER_CACHE_PUBLISHED: AtomicBool = AtomicBool::new(false);

pub(super) fn test_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be valid")
        .as_nanos();
    std::env::temp_dir().join(format!("archeion-cover-writeback-{nonce}"))
}

pub(super) fn write_image(path: &Path, width: u32, height: u32) {
    let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, Rgb([40, 80, 120])));
    image
        .save_with_format(path, ::image::ImageFormat::Png)
        .expect("image should be written");
}

pub(super) fn write_image_with_format(
    path: &Path,
    width: u32,
    height: u32,
    format: ::image::ImageFormat,
) {
    let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        width,
        height,
        Rgba([40, 80, 120, 96]),
    ));
    image
        .save_with_format(path, format)
        .expect("image should be written");
}

pub(super) fn write_epub(path: &Path, package_xml: &str, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).expect("EPUB should be created");
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default();
    archive
        .start_file("META-INF/container.xml", options)
        .expect("container should start");
    archive
        .write_all(
            br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
        )
        .expect("container should be written");
    archive
        .start_file("OEBPS/content.opf", options)
        .expect("package should start");
    archive
        .write_all(package_xml.as_bytes())
        .expect("package should be written");
    for (name, bytes) in entries {
        archive
            .start_file(*name, options)
            .expect("entry should start");
        archive.write_all(bytes).expect("entry should be written");
    }
    archive.finish().expect("EPUB should finish");
}

pub(super) fn fingerprint(path: &Path) -> (u64, u64) {
    let metadata = fs::metadata(path).expect("file should exist");
    let modified_at = metadata
        .modified()
        .expect("modified time should exist")
        .duration_since(UNIX_EPOCH)
        .expect("clock should be valid")
        .as_millis() as u64;
    (metadata.len(), modified_at)
}

pub(super) fn plan_package(
    package_xml: &str,
    source_format: CoverImageFormat,
    entries: &[(&str, &[u8])],
) -> Result<CoverPackagePlan, String> {
    let names = entries
        .iter()
        .map(|(name, _)| (*name).to_string())
        .collect::<Vec<_>>();
    let resources = entries.iter().copied().collect::<HashMap<_, _>>();
    plan_cover_package(
        "OEBPS/content.opf",
        package_xml,
        &names,
        source_format,
        |path, max_bytes| {
            let bytes = resources
                .get(path)
                .ok_or_else(|| format!("missing test resource {path}"))?;
            if bytes.len() as u64 > max_bytes {
                return Err(format!("test resource {path} is too large"));
            }
            Ok(bytes.to_vec())
        },
    )
}

pub(super) fn metadata_fixture() -> super::super::epub_metadata::EpubPackageMetadata {
    super::super::epub_metadata::EpubPackageMetadata {
        title: Some("Title".to_string()),
        creator: None,
        identifier: None,
        language: None,
        publisher: None,
        date: None,
        description: None,
        subjects: Vec::new(),
        series: None,
        volume: None,
    }
}

pub(super) fn failing_replace(_temporary_path: &Path, _epub_path: &Path) -> Result<(), String> {
    Err("simulated final replacement failure".to_string())
}

pub(super) fn restore_backup(backup_path: &Path, epub_path: &Path) -> Result<(), String> {
    if epub_path.exists() {
        fs::remove_file(epub_path).map_err(|error| error.to_string())?;
    }
    fs::rename(backup_path, epub_path).map_err(|error| error.to_string())
}

pub(super) fn failing_restore(_backup_path: &Path, _epub_path: &Path) -> Result<(), String> {
    Err("simulated restore failure".to_string())
}

pub(super) fn record_scanner_cache_publish(
    _root: &Path,
    _relative_path: &str,
    _file_stat: &super::super::epub_writeback::EpubMetadataWritebackFileStat,
    _metadata: &super::super::epub_metadata::EpubPackageMetadata,
) -> Result<(), String> {
    SCANNER_CACHE_PUBLISHED.store(true, Ordering::SeqCst);
    Ok(())
}
