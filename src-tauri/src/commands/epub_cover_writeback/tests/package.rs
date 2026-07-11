use super::{
    super::{package::update_package_cover_xml, types::CoverImageFormat},
    fixtures::*,
};

#[test]
fn plans_epub_two_cover_from_meta_reference() {
    let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-id"/></metadata><manifest><item id="cover-id" href="images/cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/images/cover.jpg", b"old-cover")],
    )
    .expect("plan should parse");

    assert!(plan.existing_cover);
    assert_eq!(plan.cover_item_id, "cover-id");
    assert_eq!(plan.cover_zip_path, "OEBPS/images/cover.jpg");
    assert_eq!(plan.package_version.major, 2);
    assert_eq!(plan.package_version.minor, 0);
}

#[test]
fn rejects_multiple_active_cover_resources() {
    let package = r#"<package version="3.0"><metadata/><manifest><item id="one" href="one.jpg" media-type="image/jpeg" properties="cover-image"/><item id="two" href="two.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine/></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/one.jpg", b"one"), ("OEBPS/two.jpg", b"two")],
    )
    .expect_err("ambiguous covers should fail");

    assert!(error.contains("multiple active cover resources"));
}

#[test]
fn rejects_cover_metadata_that_targets_an_xhtml_cover_page() {
    let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-page"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/cover.xhtml", b"<html/>")],
    )
    .expect_err("cover pages must not be overwritten as image resources");

    assert!(error.contains("unsupported media type"));
}

#[test]
fn adds_epub_three_cover_item_without_touching_spine() {
    let package = r#"<package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("plan should parse");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert!(updated.contains("properties=\"cover-image\""));
    assert!(updated.contains(
        r#"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>"#,
    ));
    assert!(updated.contains("idref=\"chapter\""));
    assert_eq!(updated.matches("<itemref").count(), 1);
    assert!(!updated.contains("name=\"cover\""));
}

#[test]
fn preserves_package_namespace_prefix_for_new_cover_elements() {
    let package = r#"<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></opf:metadata><opf:manifest><opf:item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></opf:manifest><opf:spine><opf:itemref idref="chapter"/></opf:spine></opf:package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[("OEBPS/chapter.xhtml", b"chapter")],
    )
    .expect("plan should parse");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert!(updated.contains("<opf:meta name=\"cover\""));
    assert!(updated.contains("<opf:item id=\"archeion-cover-image\""));
    assert!(!updated.contains("<meta name=\"cover\""));
    assert!(!updated.contains("<item id=\"archeion-cover-image\""));
    assert_eq!(updated.matches("<opf:itemref").count(), 1);
}

#[test]
fn epub_three_guide_cover_keeps_spine_order_and_adds_cover_property() {
    let package = r#"<package version="3.2"><metadata></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Jpeg,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.png"/></body></html>"#,
            ),
            ("OEBPS/cover.png", b"cover"),
            ("OEBPS/chapter.xhtml", b"chapter"),
        ],
    )
    .expect("explicit EPUB 3 guide cover should resolve");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert!(updated.contains(
        "id=\"cover-image\" href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\""
    ));
    let cover_position = updated
        .find("idref=\"cover-page\"")
        .expect("cover itemref should remain");
    let chapter_position = updated
        .find("idref=\"chapter\"")
        .expect("chapter itemref should remain");
    assert!(cover_position < chapter_position);
    assert_eq!(updated.matches("<itemref").count(), 2);
}
