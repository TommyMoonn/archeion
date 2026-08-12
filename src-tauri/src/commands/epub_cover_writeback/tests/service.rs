use std::{fs, io::Write, sync::atomic::Ordering};

use super::{
    super::{
        service::write_cover_at,
        types::{EpubCoverFraming, EpubCoverWritebackInput},
    },
    fixtures::*,
};
use crate::commands::epub_analysis_cache;

#[test]
fn successful_cover_write_invalidates_only_the_edited_epub_analysis() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#,
        &[("OEBPS/chapter.xhtml", b"<html><body>chapter</body></html>")],
    );
    epub_analysis_cache::seed_test_entries(&root, &["book.epub", "other.epub"]);
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-1".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Fit,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect("cover write should succeed");

    assert!(!epub_analysis_cache::contains_test_entry(
        &root,
        "book.epub",
        0
    ));
    assert!(epub_analysis_cache::contains_test_entry(
        &root,
        "other.epub",
        1
    ));
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn landmark_dependency_analysis_failure_leaves_epub_byte_for_byte_unchanged() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            (
                "OEBPS/cover.css",
                b"body { background-image: url('cover.jpg'); }",
            ),
            ("OEBPS/cover.jpg", b"old-cover"),
        ],
    );
    let original = fs::read(&epub_path).expect("original EPUB should read");
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    let error = write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-landmark-unsafe".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect_err("unsafe stylesheet should fail before mutation");

    assert!(error.contains("image resource dependency"), "{error}");
    assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn conflicting_cover_declarations_do_not_mutate_original_epub() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="2.0"><metadata><meta name="cover" content="declared"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="visible.jpg"/></body></html>"#,
            ),
            ("OEBPS/declared.jpg", b"declared"),
            ("OEBPS/visible.jpg", b"visible"),
        ],
    );
    let original = fs::read(&epub_path).expect("original EPUB should read");
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    let error = write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-conflict".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect_err("conflicting declarations should fail");

    assert!(
        error.contains("point to different image resources"),
        "{error}"
    );
    assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn rejects_when_selected_image_changes_after_preview() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    );
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);
    write_image(&image_path, 700, 1050);

    let error = write_cover_at(
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
    .expect_err("stale image preview should fail");

    assert!(error.contains("selected cover image changed after the preview"));
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn rejects_when_epub_changes_after_preview() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    );
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);
    fs::OpenOptions::new()
        .append(true)
        .open(&epub_path)
        .expect("EPUB should open")
        .write_all(b"changed")
        .expect("EPUB should change");

    let error = write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-1".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Fit,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect_err("stale preview should fail");

    assert!(error.contains("EPUB file changed after the preview"));
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn cover_final_replacement_failure_restores_original_without_publishing_cache_state() {
    SCANNER_CACHE_PUBLISHED.store(false, Ordering::SeqCst);
    let root = test_root();
    fs::create_dir_all(root.join(".archeion/covers")).expect("cache folder should be created");
    let epub_path = root.join("book.epub");
    let temporary_path = root.join("book.epub.cover-writeback.tmp");
    let cache_path = root.join(".archeion/covers/book-1.jpg");
    fs::write(&epub_path, b"original-epub").expect("original EPUB should be written");
    fs::write(&temporary_path, b"replacement-epub").expect("replacement EPUB should be written");
    fs::write(&cache_path, b"existing-cache").expect("cache sentinel should be written");

    let error = super::super::super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
        &root,
        "book.epub",
        &epub_path,
        &temporary_path,
        metadata_fixture(),
        "cover",
        failing_replace,
        restore_backup,
        record_scanner_cache_publish,
    )
    .expect_err("final replacement should fail");

    assert!(error.contains("EPUB cover write failed"), "{error}");
    assert!(error.contains("backup was restored"), "{error}");
    assert_eq!(
        fs::read(&epub_path).expect("original EPUB should be restored"),
        b"original-epub"
    );
    assert!(!temporary_path.exists());
    assert_eq!(
        fs::read(&cache_path).expect("cache sentinel should remain"),
        b"existing-cache"
    );
    assert!(!SCANNER_CACHE_PUBLISHED.load(Ordering::SeqCst));
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn cover_restore_failure_keeps_recovery_backup_and_reports_its_location() {
    SCANNER_CACHE_PUBLISHED.store(false, Ordering::SeqCst);
    let root = test_root();
    fs::create_dir_all(root.join(".archeion/covers")).expect("cache folder should be created");
    let epub_path = root.join("book.epub");
    let temporary_path = root.join("book.epub.cover-writeback.tmp");
    let cache_path = root.join(".archeion/covers/book-1.jpg");
    fs::write(&epub_path, b"original-epub").expect("original EPUB should be written");
    fs::write(&temporary_path, b"replacement-epub").expect("replacement EPUB should be written");
    fs::write(&cache_path, b"existing-cache").expect("cache sentinel should be written");

    let error = super::super::super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
        &root,
        "book.epub",
        &epub_path,
        &temporary_path,
        metadata_fixture(),
        "cover",
        failing_replace,
        failing_restore,
        record_scanner_cache_publish,
    )
    .expect_err("restore should fail");

    assert!(error.contains("EPUB cover write failed"), "{error}");
    assert!(error.contains("automatic restore failed"), "{error}");
    assert!(error.contains("Backup is available at"), "{error}");
    let backup_dir = root.join(".archeion/backups/epub-writeback");
    let backups = fs::read_dir(&backup_dir)
        .expect("backup directory should remain")
        .map(|entry| entry.expect("backup entry should read").path())
        .collect::<Vec<_>>();
    assert_eq!(backups.len(), 1);
    assert_eq!(
        fs::read(&backups[0]).expect("recovery backup should remain"),
        b"original-epub"
    );
    assert!(!epub_path.exists());
    assert!(!temporary_path.exists());
    assert_eq!(
        fs::read(&cache_path).expect("cache sentinel should remain"),
        b"existing-cache"
    );
    assert!(!SCANNER_CACHE_PUBLISHED.load(Ordering::SeqCst));
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn deterministic_resolution_failure_leaves_original_epub_unchanged() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="text-cover" href="Text/cover.jpg" media-type="image/jpeg"/><item id="images-cover" href="Images/cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/Text/cover.xhtml",
                br#"<html><head><base href="../Images/"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/Text/cover.jpg", b"text-cover"),
            ("OEBPS/Images/cover.jpg", b"images-cover"),
        ],
    );
    let original = fs::read(&epub_path).expect("original EPUB should read");
    let (image_size, image_modified_at) = fingerprint(&image_path);
    let (epub_size, epub_modified_at) = fingerprint(&epub_path);

    let error = write_cover_at(
        &root,
        EpubCoverWritebackInput {
            relative_path: "book.epub".to_string(),
            book_id: "book-base-unsafe".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect_err("base override should fail before mutation");

    assert!(
        error.contains("document-relative resources cannot be resolved safely"),
        "{error}"
    );
    assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
    fs::remove_dir_all(root).expect("root should be removed");
}
