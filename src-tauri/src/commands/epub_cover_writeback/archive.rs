use std::{
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use ::image::{GenericImageView, ImageReader, Limits};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::{
    super::epub_metadata,
    cover_document::resolve_cover_page_relationships,
    image::MAX_SOURCE_FILE_BYTES,
    package::{plan_cover_package, CoverPackagePlan},
    types::CoverImageFormat,
};

fn temporary_epub_path(epub_path: &Path) -> Result<PathBuf, String> {
    let file_name = epub_path
        .file_name()
        .ok_or_else(|| "The EPUB file is unavailable.".to_string())?
        .to_string_lossy();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(epub_path.with_file_name(format!("{file_name}.cover-writeback-{nonce}.tmp")))
}

pub(super) fn rewrite_epub_cover(
    epub_path: &Path,
    package_path: &str,
    package_xml: &str,
    plan: &CoverPackagePlan,
    cover_bytes: &[u8],
) -> Result<PathBuf, String> {
    let temporary_path = temporary_epub_path(epub_path)?;
    let write_result = (|| -> Result<PathBuf, String> {
        let source = File::open(epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(source).map_err(|error| error.to_string())?;
        let temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(temporary);
        let mut package_entry_count = 0_usize;
        let mut cover_entry_count = 0_usize;

        for index in 0..archive.len() {
            let (name, compression) = {
                let entry = archive.by_index(index).map_err(|error| error.to_string())?;
                (entry.name().to_string(), entry.compression())
            };
            let options = SimpleFileOptions::default().compression_method(compression);
            if name == package_path {
                package_entry_count += 1;
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(package_xml.as_bytes())
                    .map_err(|error| error.to_string())?;
                continue;
            }
            if name == plan.cover_zip_path {
                cover_entry_count += 1;
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(cover_bytes)
                    .map_err(|error| error.to_string())?;
                continue;
            }
            let entry = archive
                .by_index_raw(index)
                .map_err(|error| error.to_string())?;
            writer
                .raw_copy_file(entry)
                .map_err(|error| error.to_string())?;
        }

        if package_entry_count != 1 {
            return Err(format!(
                "EPUB package document entry was expected once but found {package_entry_count} times."
            ));
        }
        if plan.existing_cover && cover_entry_count != 1 {
            return Err(format!(
                "EPUB cover resource entry was expected once but found {cover_entry_count} times."
            ));
        }
        if !plan.existing_cover {
            if cover_entry_count != 0 {
                return Err("The generated EPUB cover path already exists.".to_string());
            }
            writer
                .start_file(
                    plan.cover_zip_path.as_str(),
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| error.to_string())?;
            writer
                .write_all(cover_bytes)
                .map_err(|error| error.to_string())?;
        }

        let output = writer.finish().map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        Ok(temporary_path.clone())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn archive_names(archive: &mut ZipArchive<File>) -> Result<Vec<String>, String> {
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        names.push(
            archive
                .by_index(index)
                .map_err(|error| error.to_string())?
                .name()
                .to_string(),
        );
    }
    Ok(names)
}

fn read_archive_entry_limited(
    archive: &mut ZipArchive<File>,
    path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    archive
        .by_name(path)
        .map_err(|error| error.to_string())?
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "The EPUB resource \"{path}\" is too large to analyze safely. The file was not modified."
        ));
    }
    Ok(bytes)
}

pub(super) fn analyze_package<R>(
    package_path: &str,
    package_xml: &str,
    archive_names: &[String],
    source_format: CoverImageFormat,
    read_archive_entry: &mut R,
) -> Result<CoverPackagePlan, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    plan_cover_package(
        package_path,
        package_xml,
        archive_names,
        source_format,
        |manifest, archive_name_counts| {
            resolve_cover_page_relationships(
                package_path,
                manifest,
                archive_name_counts,
                read_archive_entry,
            )
        },
    )
}

pub(super) fn read_package_and_plan(
    epub_path: &Path,
    source_format: CoverImageFormat,
) -> Result<(epub_metadata::EpubPackageDocument, CoverPackagePlan), String> {
    let file = File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = epub_metadata::read_package_document(&mut archive)?;
    let names = archive_names(&mut archive)?;
    let plan = analyze_package(
        &package.path,
        &package.xml,
        &names,
        source_format,
        &mut |path, max_bytes| read_archive_entry_limited(&mut archive, path, max_bytes),
    )?;
    Ok((package, plan))
}

pub(super) fn validate_rewritten_cover(
    epub_path: &Path,
) -> Result<epub_metadata::EpubPackageMetadata, String> {
    let file = File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = epub_metadata::read_package_document(&mut archive)?;
    let names = archive_names(&mut archive)?;
    let plan = analyze_package(
        &package.path,
        &package.xml,
        &names,
        CoverImageFormat::Png,
        &mut |path, max_bytes| read_archive_entry_limited(&mut archive, path, max_bytes),
    )?;
    if !plan.existing_cover {
        return Err("The rewritten EPUB does not declare an active cover resource.".to_string());
    }
    let mut cover_bytes = Vec::new();
    archive
        .by_name(&plan.cover_zip_path)
        .map_err(|error| error.to_string())?
        .take(MAX_SOURCE_FILE_BYTES + 1)
        .read_to_end(&mut cover_bytes)
        .map_err(|error| error.to_string())?;
    if cover_bytes.len() as u64 > MAX_SOURCE_FILE_BYTES {
        return Err("The rewritten EPUB cover resource is too large.".to_string());
    }
    let mut reader = ImageReader::new(Cursor::new(&cover_bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let encoded_format = reader
        .format()
        .and_then(CoverImageFormat::from_image_format)
        .ok_or_else(|| "The rewritten EPUB cover format is unsupported.".to_string())?;
    let declared_format = plan
        .existing_media_type
        .as_deref()
        .and_then(CoverImageFormat::from_media_type)
        .ok_or_else(|| "The rewritten EPUB cover media type is unsupported.".to_string())?;
    if encoded_format != declared_format {
        return Err(
            "The rewritten EPUB cover bytes do not match the declared media type.".to_string(),
        );
    }
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|error| error.to_string())?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 || u64::from(width) * 3 != u64::from(height) * 2 {
        return Err("The rewritten EPUB cover has an invalid frame.".to_string());
    }
    epub_metadata::parse_core_metadata(&package.xml)
}
