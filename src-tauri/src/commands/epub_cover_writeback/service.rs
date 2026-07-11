use std::{fs, path::Path};

use ::image::GenericImageView;

use super::{
    super::{archive_root, epub, epub_writeback, filesystem},
    archive::{read_package_and_plan, rewrite_epub_cover, validate_rewritten_cover},
    fingerprint::{assert_fingerprint, file_fingerprint},
    image::{decode_cover_image, preview_bytes, process_cover_image},
    package::update_package_cover_xml,
    types::{
        EpubCoverPreparation, EpubCoverPreparationInput, EpubCoverWritebackInput,
        EpubCoverWritebackResult,
    },
};

pub(super) fn validate_book_id(book_id: &str) -> Result<(), String> {
    if book_id.is_empty()
        || !book_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        return Err("The selected book identifier is invalid.".to_string());
    }
    Ok(())
}

pub(super) fn prepare_cover_writeback_at(
    root: &Path,
    input: &EpubCoverPreparationInput,
) -> Result<EpubCoverPreparation, String> {
    let normalized_relative_path =
        filesystem::normalize_archive_relative_path(&input.relative_path)?;
    let epub_path = epub::resolve_epub_path(root, &normalized_relative_path)?;
    let epub_fingerprint = file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    let decoded = decode_cover_image(Path::new(&input.image_path))?;
    let (_, plan) = read_package_and_plan(&epub_path, decoded.format)?;
    let processed = process_cover_image(&decoded, input.framing, plan.output_format)?;
    let (source_width, source_height) = decoded.image.dimensions();
    let (output_width, output_height) = processed.image.dimensions();
    let epub_fingerprint_after_prepare =
        file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    if epub_fingerprint_after_prepare.size != epub_fingerprint.size
        || epub_fingerprint_after_prepare.modified_at != epub_fingerprint.modified_at
    {
        return Err(
            "The EPUB file changed while the cover preview was being prepared. Review it again."
                .to_string(),
        );
    }

    Ok(EpubCoverPreparation {
        file_name: decoded.file_name,
        source_format: decoded.format.label().to_string(),
        output_format: processed.format.label().to_string(),
        source_width,
        source_height,
        output_width,
        output_height,
        image_size: decoded.fingerprint.size,
        image_modified_at: decoded.fingerprint.modified_at,
        epub_size: epub_fingerprint.size,
        epub_modified_at: epub_fingerprint.modified_at,
        replacing_existing_cover: plan.existing_cover,
        preview_mime_type: "image/png".to_string(),
        preview_bytes: preview_bytes(&processed.image)?,
    })
}

pub(super) fn write_cover_at(
    root: &Path,
    input: EpubCoverWritebackInput,
) -> Result<EpubCoverWritebackResult, String> {
    validate_book_id(&input.book_id)?;
    let normalized_relative_path =
        filesystem::normalize_archive_relative_path(&input.relative_path)?;
    let epub_path = epub::resolve_epub_path(root, &normalized_relative_path)?;
    let epub_fingerprint = file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    assert_fingerprint(
        "EPUB file",
        &epub_fingerprint,
        input.expected_epub_size,
        input.expected_epub_modified_at,
    )?;
    let decoded = decode_cover_image(Path::new(&input.image_path))?;
    assert_fingerprint(
        "selected cover image",
        &decoded.fingerprint,
        input.expected_image_size,
        input.expected_image_modified_at,
    )?;

    let (package, plan) = read_package_and_plan(&epub_path, decoded.format)?;
    let processed = process_cover_image(&decoded, input.framing, plan.output_format)?;
    let updated_package_xml = update_package_cover_xml(&package.xml, &plan, plan.output_format)?;
    let temporary_path = rewrite_epub_cover(
        &epub_path,
        &package.path,
        &updated_package_xml,
        &plan,
        &processed.bytes,
    )
    .map_err(|error| {
        format!("EPUB cover write failed before replacing the active file. {error}")
    })?;
    let source_metadata = match validate_rewritten_cover(&temporary_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "EPUB cover validation failed before replacing the active file. The original EPUB was not modified. {error}"
            ));
        }
    };
    let current_epub_fingerprint =
        file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    if let Err(error) = assert_fingerprint(
        "EPUB file",
        &current_epub_fingerprint,
        input.expected_epub_size,
        input.expected_epub_modified_at,
    ) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    let writeback = epub_writeback::commit_epub_rewrite_at(
        root,
        &normalized_relative_path,
        &epub_path,
        &temporary_path,
        source_metadata,
        input.keep_successful_backup,
        "cover",
    )?;

    let cover_cache_warning = (|| -> Result<(), String> {
        archive_root::invalidate_cover_cache_entries_at(root, std::slice::from_ref(&input.book_id))?;
        epub::load_epub_cover_at(root, &normalized_relative_path, &input.book_id)?;
        Ok(())
    })()
    .err()
    .map(|error| {
        format!(
            "The cover was written, but its generated preview cache could not be refreshed. Reopen or regenerate the cover. {error}"
        )
    });

    Ok(EpubCoverWritebackResult {
        writeback,
        cover_cache_warning,
    })
}
