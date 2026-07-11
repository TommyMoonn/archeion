use std::fs;

use ::image::{DynamicImage, Rgba, RgbaImage};

use super::{
    super::{
        image::{decode_cover_image, process_cover_image},
        package::update_package_cover_xml,
        service::prepare_cover_writeback_at,
        types::{CoverImageFormat, EpubCoverFraming, EpubCoverPreparationInput},
    },
    fixtures::{plan_package, test_root, write_epub, write_image, write_image_with_format},
};

#[test]
fn crop_and_fit_produce_exact_two_by_three_frames() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let image_path = root.join("wide.png");
    write_image(&image_path, 900, 500);
    let decoded = decode_cover_image(&image_path).expect("image should decode");

    for framing in [EpubCoverFraming::Crop, EpubCoverFraming::Fit] {
        let processed = process_cover_image(&decoded, framing, CoverImageFormat::Png)
            .expect("image should process");
        assert_eq!(
            u64::from(processed.image.width()) * 3,
            u64::from(processed.image.height()) * 2
        );
    }
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn jpeg_output_flattens_transparency_to_white_in_the_preview_and_resource() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let image_path = root.join("transparent.png");
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(300, 450, Rgba([0, 0, 0, 0])))
        .save_with_format(&image_path, ::image::ImageFormat::Png)
        .expect("image should be written");
    let decoded = decode_cover_image(&image_path).expect("image should decode");

    let processed = process_cover_image(&decoded, EpubCoverFraming::Crop, CoverImageFormat::Jpeg)
        .expect("image should process");
    let rgba = processed.image.to_rgba8();
    let pixel = rgba.get_pixel(0, 0).0;

    assert_eq!(pixel, [255, 255, 255, 255]);
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn webp_source_converts_to_png_for_epub_two() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::WebP,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("EPUB 2 plan should parse");

    assert_eq!(plan.output_format, CoverImageFormat::Png);
    assert!(plan.cover_href.ends_with(".png"));
}

#[test]
fn webp_source_converts_to_png_for_epub_three_zero() {
    let package = r#"<package version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::WebP,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("EPUB 3.0 plan should parse");

    assert_eq!(plan.output_format, CoverImageFormat::Png);
    assert!(plan.cover_href.ends_with(".png"));
}

#[test]
fn webp_source_converts_to_png_for_epub_three_two() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::WebP,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("EPUB 3.2 plan should parse");

    assert_eq!(plan.output_format, CoverImageFormat::Png);
    assert!(plan.cover_href.ends_with(".png"));
}

#[test]
fn webp_source_remains_webp_for_epub_three_three() {
    let package = r#"<package version=" 3.3 "><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::WebP,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("EPUB 3.3 plan should parse");

    assert_eq!(plan.output_format, CoverImageFormat::WebP);
    assert!(plan.cover_href.ends_with(".webp"));
}

#[test]
fn jpeg_and_png_sources_remain_compatible_across_supported_versions() {
    for version in ["2.0", "3.0", "3.1", "3.2", "3.3"] {
        for format in [CoverImageFormat::Jpeg, CoverImageFormat::Png] {
            let package = format!(
                r#"<package version="{version}"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#
            );
            let plan = plan_package(&package, format, &[("OEBPS/chapter.xhtml", b"chapter")])
                .expect("compatible plan should parse");
            assert_eq!(plan.output_format, format, "version {version}");
        }
    }
}

#[test]
fn existing_jpeg_and_png_cover_formats_are_preserved() {
    for (media_type, href, expected) in [
        ("image/jpeg", "images/cover.jpeg", CoverImageFormat::Jpeg),
        ("image/png", "images/cover.png", CoverImageFormat::Png),
    ] {
        let package = format!(
            r#"<package version="2.0"><metadata><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="{href}" media-type="{media_type}"/></manifest><spine/></package>"#
        );
        let zip_path = format!("OEBPS/{href}");
        let plan = plan_package(
            &package,
            CoverImageFormat::WebP,
            &[(zip_path.as_str(), b"existing")],
        )
        .expect("existing compatible format should be preserved");
        assert_eq!(plan.output_format, expected);
        assert_eq!(plan.cover_href, href);
    }
}

#[test]
fn existing_webp_cover_is_rejected_before_epub_three_three() {
    for version in ["2.0", "3.2"] {
        let package = format!(
            r#"<package version="{version}"><metadata><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="images/cover.webp" media-type="image/webp"/></manifest><spine/></package>"#
        );
        let error = plan_package(
            &package,
            CoverImageFormat::Png,
            &[("OEBPS/images/cover.webp", b"existing")],
        )
        .expect_err("incompatible existing WebP should fail");
        assert!(error.contains("not supported by EPUB"), "{error}");
    }
}

#[test]
fn existing_webp_cover_is_preserved_for_epub_three_three() {
    let package = r#"<package version="3.3"><metadata/><manifest><item id="cover" href="images/cover.webp" media-type="image/webp" properties="cover-image"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/images/cover.webp", b"existing")],
    )
    .expect("EPUB 3.3 WebP cover should remain supported");
    assert_eq!(plan.output_format, CoverImageFormat::WebP);
}

#[test]
fn generated_href_media_type_and_encoded_bytes_use_the_same_format() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let image_path = root.join("replacement.webp");
    write_image_with_format(&image_path, 600, 900, ::image::ImageFormat::WebP);
    let decoded = decode_cover_image(&image_path).expect("WebP should decode");
    let package = r#"<package version="3.2"><metadata></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        decoded.format,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("plan should parse");
    let processed = process_cover_image(&decoded, EpubCoverFraming::Crop, plan.output_format)
        .expect("cover should process");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert!(plan.cover_href.ends_with(".png"));
    assert!(updated.contains("media-type=\"image/png\""));
    assert_eq!(
        ::image::guess_format(&processed.bytes).expect("encoded format should be detectable"),
        ::image::ImageFormat::Png,
    );
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn preview_reports_actual_png_output_for_webp_source_in_epub_three_two() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.webp");
    write_image_with_format(&image_path, 600, 900, ::image::ImageFormat::WebP);
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    );

    let preparation = prepare_cover_writeback_at(
        &root,
        &EpubCoverPreparationInput {
            relative_path: "book.epub".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
        },
    )
    .expect("preview should prepare");

    assert_eq!(preparation.source_format, "WebP");
    assert_eq!(preparation.output_format, "PNG");
    assert_eq!(preparation.preview_mime_type, "image/png");
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn malformed_or_unknown_package_versions_do_not_enable_webp() {
    for version in ["", "3", "3.x", "3.3.0", "2.1", "4.0"] {
        let package = format!(
            r#"<package version="{version}"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#
        );
        let error = plan_package(
            &package,
            CoverImageFormat::WebP,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect_err("unknown package version should fail conservatively");
        assert!(
            error.contains("version") || error.contains("supported"),
            "{error}"
        );
    }
}
