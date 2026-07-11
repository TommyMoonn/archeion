use std::{fs, io::Read};

use super::{
    super::{
        archive::{read_package_and_plan, validate_rewritten_cover},
        service::write_cover_at,
        types::{CoverImageFormat, EpubCoverFraming, EpubCoverWritebackInput},
    },
    fixtures::*,
};

#[test]
fn writes_landmark_only_cover_without_changing_navigation_page_or_spine() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 900, 1200);
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml#cover">Cover</a></li></ol></nav></body></html>"#;
    let cover_page = br#"<html><body><img id="cover" src="images/cover.jpg"/></body></html>"#;
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine></package>"#,
        &[
            ("OEBPS/nav.xhtml", navigation),
            ("OEBPS/cover.xhtml", cover_page),
            ("OEBPS/images/cover.jpg", b"old-cover"),
            ("OEBPS/chapter.xhtml", b"chapter"),
        ],
    );
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-landmark".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect("landmark-only cover should write");

    let file = fs::File::open(&epub_path).expect("EPUB should open");
    let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
    let names = (0..archive.len())
        .map(|index| {
            archive
                .by_index(index)
                .expect("entry should read")
                .name()
                .to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        names
            .iter()
            .filter(|name| name.as_str() == "OEBPS/images/cover.jpg")
            .count(),
        1
    );
    assert!(!names.iter().any(|name| name.contains("archeion-cover")));

    let package = super::super::super::epub_metadata::read_package_document(&mut archive)
        .expect("package should be readable");
    assert!(package.xml.contains(
        "id=\"cover-resource\" href=\"images/cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\""
    ));
    assert_eq!(package.xml.matches("<item ").count(), 4);
    assert_eq!(package.xml.matches("<itemref").count(), 2);
    let cover_position = package
        .xml
        .find("idref=\"cover-page\"")
        .expect("cover itemref should remain");
    let chapter_position = package
        .xml
        .find("idref=\"chapter\"")
        .expect("chapter itemref should remain");
    assert!(cover_position < chapter_position);

    let mut navigation_after = Vec::new();
    archive
        .by_name("OEBPS/nav.xhtml")
        .expect("navigation should remain")
        .read_to_end(&mut navigation_after)
        .expect("navigation should read");
    assert_eq!(navigation_after, navigation);

    let mut cover_page_after = Vec::new();
    archive
        .by_name("OEBPS/cover.xhtml")
        .expect("cover page should remain")
        .read_to_end(&mut cover_page_after)
        .expect("cover page should read");
    assert_eq!(cover_page_after, cover_page);
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn writes_cover_into_existing_epub_two_resource_and_preserves_cover_page() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 900, 1200);
    write_epub(
        &epub_path,
        r#"<package version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Title</dc:title><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#,
        &[
            ("OEBPS/images/cover.jpg", b"old-cover"),
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="images/cover.jpg"/></body></html>"#,
            ),
        ],
    );
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);
    let result = write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-1".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect("cover should write");

    assert!(result.cover_cache_warning.is_none());
    validate_rewritten_cover(&epub_path).expect("rewritten EPUB should validate");
    let file = fs::File::open(&epub_path).expect("EPUB should open");
    let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
    let package = super::super::super::epub_metadata::read_package_document(&mut archive)
        .expect("package should be readable");
    assert!(package.xml.contains("href=\"images/cover.jpg\""));
    assert!(package.xml.contains("media-type=\"image/jpeg\""));
    let mut cover_page = String::new();
    archive
        .by_name("OEBPS/cover.xhtml")
        .expect("cover page should remain")
        .read_to_string(&mut cover_page)
        .expect("cover page should read");
    assert!(cover_page.contains("images/cover.jpg"));
    let mut cover_bytes = Vec::new();
    archive
        .by_name("OEBPS/images/cover.jpg")
        .expect("cover resource should remain")
        .read_to_end(&mut cover_bytes)
        .expect("cover resource should read");
    assert_eq!(
        ::image::guess_format(&cover_bytes).expect("cover format should be detectable"),
        ::image::ImageFormat::Jpeg,
    );
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn writes_guide_only_cover_into_existing_resource_without_duplicate_cover_entries() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 900, 1200);
    write_epub(
        &epub_path,
        r#"<package version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="Text/cover.xhtml"/></guide></package>"#,
        &[
            (
                "OEBPS/Text/cover.xhtml",
                br#"<html><body><img src="../Images/cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/Images/cover.jpg", b"old-cover"),
            ("OEBPS/Text/chapter.xhtml", b"chapter"),
        ],
    );
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-guide-only".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect("guide-only cover should write");

    let file = fs::File::open(&epub_path).expect("EPUB should open");
    let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
    let names = (0..archive.len())
        .map(|index| {
            archive
                .by_index(index)
                .expect("entry should read")
                .name()
                .to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        names
            .iter()
            .filter(|name| name.as_str() == "OEBPS/Images/cover.jpg")
            .count(),
        1
    );
    assert!(!names.iter().any(|name| name.contains("archeion-cover")));

    let package = super::super::super::epub_metadata::read_package_document(&mut archive)
        .expect("package should be readable");
    assert!(package
        .xml
        .contains("<meta name=\"cover\" content=\"cover-image\"/>"));
    assert!(package.xml.contains("href=\"Text/cover.xhtml\""));
    assert_eq!(package.xml.matches("<itemref").count(), 2);
    assert_eq!(package.xml.matches("name=\"cover\"").count(), 1);

    let mut cover_page = String::new();
    archive
        .by_name("OEBPS/Text/cover.xhtml")
        .expect("cover page should remain")
        .read_to_string(&mut cover_page)
        .expect("cover page should read");
    assert!(cover_page.contains("../Images/cover.jpg"));

    let mut cover_bytes = Vec::new();
    archive
        .by_name("OEBPS/Images/cover.jpg")
        .expect("cover image should remain")
        .read_to_end(&mut cover_bytes)
        .expect("cover image should read");
    assert_eq!(
        ::image::guess_format(&cover_bytes).expect("cover format should be detectable"),
        ::image::ImageFormat::Jpeg,
    );
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn reads_package_and_plan_for_existing_epub_three_cover() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata/><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine/></package>"#,
        &[("OEBPS/cover.png", b"image")],
    );

    let (_, plan) =
        read_package_and_plan(&epub_path, CoverImageFormat::Jpeg).expect("plan should load");
    assert_eq!(plan.cover_item_id, "cover");
    assert_eq!(plan.existing_media_type.as_deref(), Some("image/png"));
    fs::remove_dir_all(root).expect("root should be removed");
}
