mod fixtures;
mod image;

use std::{
    fs,
    io::{Read, Write},
    sync::atomic::Ordering,
};

use self::fixtures::*;
use super::{
    read_package_and_plan, types::EpubCoverFraming, update_package_cover_xml,
    validate_rewritten_cover, write_cover_at, CoverImageFormat, EpubCoverWritebackInput,
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
fn resolves_epub_two_guide_only_cover_page_and_preserves_reading_order() {
    let package = r#"<package version="2.0"><metadata></metadata><manifest><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" title="Cover" href="Text/cover.xhtml"/></guide></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/Text/cover.xhtml",
                br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/Images/cover.jpg", b"old-cover"),
            ("OEBPS/Text/chapter.xhtml", b"chapter"),
        ],
    )
    .expect("guide-only cover should resolve");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert!(plan.existing_cover);
    assert_eq!(plan.cover_item_id, "cover-image");
    assert_eq!(plan.cover_zip_path, "OEBPS/Images/cover.jpg");
    assert!(updated.contains("<meta name=\"cover\" content=\"cover-image\"/>"));
    assert!(updated.contains("href=\"Text/cover.xhtml\""));
    assert!(updated.contains("<itemref idref=\"cover-page\"/>"));
    assert!(updated.contains("<itemref idref=\"chapter\"/>"));
    assert_eq!(updated.matches("<itemref").count(), 2);
}

#[test]
fn declared_cover_and_guide_page_may_reference_the_same_image() {
    let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="images/cover.png" media-type="image/png"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Jpeg,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="images/cover.png"/></body></html>"#,
            ),
            ("OEBPS/images/cover.png", b"old-cover"),
        ],
    )
    .expect("coherent cover declarations should work");

    assert_eq!(plan.cover_item_id, "cover-image");
    assert_eq!(plan.output_format, CoverImageFormat::Png);
}

#[test]
fn cover_page_with_two_candidate_images_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.jpg" media-type="image/jpeg"/><item id="two" href="two.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="one.jpg"/><img src="two.jpg"/></body></html>"#,
            ),
            ("OEBPS/one.jpg", b"one"),
            ("OEBPS/two.jpg", b"two"),
        ],
    )
    .expect_err("ambiguous cover page should fail");
    assert!(error.contains("multiple candidate images"), "{error}");
}

#[test]
fn css_background_cover_page_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><style>body { background-image: url('cover.jpg'); }</style></head><body/></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("CSS cover should fail");
    assert!(error.contains("image resource dependency"), "{error}");
}

#[test]
fn missing_cover_page_image_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="missing.jpg" media-type="image/jpeg"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[(
            "OEBPS/cover.xhtml",
            br#"<html><body><img src="missing.jpg"/></body></html>"#,
        )],
    )
    .expect_err("missing cover image should fail");
    assert!(error.contains("is missing"), "{error}");
}

#[test]
fn cover_page_image_outside_manifest_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="images/cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/images/cover.jpg", b"cover"),
        ],
    )
    .expect_err("unmanifested cover image should fail");
    assert!(error.contains("not tied to a manifest item"), "{error}");
}

#[test]
fn external_cover_page_image_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[(
            "OEBPS/cover.xhtml",
            br#"<html><body><img src="https://example.com/cover.jpg"/></body></html>"#,
        )],
    )
    .expect_err("external cover image should fail");
    assert!(error.contains("external, embedded, or unsafe"), "{error}");
}

#[test]
fn malformed_cover_page_xml_fails_safely() {
    let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.jpg"></body></broken>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("malformed XHTML should fail");
    assert!(error.contains("malformed"), "{error}");
}

#[test]
fn conflicting_package_and_guide_cover_declarations_fail_safely() {
    let package = r#"<package version="2.0"><metadata><meta name="cover" content="declared"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="visible.jpg"/></body></html>"#,
            ),
            ("OEBPS/declared.jpg", b"declared"),
            ("OEBPS/visible.jpg", b"visible"),
        ],
    )
    .expect_err("conflicting covers should fail");
    assert!(
        error.contains("point to different image resources"),
        "{error}"
    );
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

#[test]
fn resolves_landmark_only_covers_across_supported_epub_three_versions() {
    for version in ["3.0", "3.2", "3.3"] {
        let package = format!(
            r#"<package version="{version}"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine></package>"#
        );
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml#cover">Cover</a></li></ol></nav></body></html>"#;
        let plan = plan_package(
            &package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img id="cover" src="images/cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/images/cover.jpg", b"old-cover"),
                ("OEBPS/chapter.xhtml", b"chapter"),
            ],
        )
        .expect("landmark-only cover should resolve");
        let updated = update_package_cover_xml(&package, &plan, plan.output_format)
            .expect("package should update");

        assert!(plan.existing_cover, "version {version}");
        assert_eq!(plan.cover_item_id, "cover-resource", "version {version}");
        assert_eq!(
            plan.cover_zip_path, "OEBPS/images/cover.jpg",
            "version {version}"
        );
        assert!(updated.contains(
            "id=\"cover-resource\" href=\"images/cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\""
        ));
        assert_eq!(updated.matches("<item ").count(), 4);
        assert_eq!(updated.matches("<itemref").count(), 2);
        let cover_position = updated
            .find("idref=\"cover-page\"")
            .expect("cover itemref should remain");
        let chapter_position = updated
            .find("idref=\"chapter\"")
            .expect("chapter itemref should remain");
        assert!(cover_position < chapter_position);
    }
}

#[test]
fn coherent_package_guide_and_landmarks_declarations_resolve_to_one_cover() {
    let package = r#"<package version="3.2"><metadata><meta name="cover" content="cover-resource"/></metadata><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.png" media-type="image/png" properties="cover-image"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Jpeg,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li></ol></nav></body></html>"#,
            ),
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.png"/></body></html>"#,
            ),
            ("OEBPS/cover.png", b"old-cover"),
            ("OEBPS/chapter.xhtml", b"chapter"),
        ],
    )
    .expect("coherent declarations should resolve");
    let updated = update_package_cover_xml(package, &plan, plan.output_format)
        .expect("package should update");

    assert_eq!(plan.cover_item_id, "cover-resource");
    assert_eq!(updated.matches("properties=\"cover-image\"").count(), 1);
    assert_eq!(updated.matches("name=\"cover\"").count(), 1);
    assert_eq!(updated.matches("<itemref").count(), 2);
}

#[test]
fn package_cover_and_landmarks_conflict_fails_safely() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg" properties="cover-image"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="visible.jpg"/></body></html>"#,
            ),
            ("OEBPS/declared.jpg", b"declared"),
            ("OEBPS/visible.jpg", b"visible"),
        ],
    )
    .expect_err("conflicting package and landmark covers should fail");

    assert!(
        error.contains("visible cover page point to different image resources"),
        "{error}"
    );
}

#[test]
fn guide_and_landmarks_must_identify_the_same_cover_page() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="guide-page" href="guide.xhtml" media-type="application/xhtml+xml"/><item id="landmark-page" href="landmark.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="guide-page"/><itemref idref="landmark-page"/></spine><guide><reference type="cover" href="guide.xhtml"/></guide></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="landmark.xhtml">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/guide.xhtml",
                br#"<html><body><img src="cover.jpg"/></body></html>"#,
            ),
            (
                "OEBPS/landmark.xhtml",
                br#"<html><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("different visible cover pages should fail");

    assert!(error.contains("different cover pages"), "{error}");
}

#[test]
fn ambiguous_or_invalid_landmarks_navigation_fails_safely() {
    let base_manifest = |navigation_items: &str, cover_item: &str| {
        format!(
            r#"<package version="3.2"><metadata/><manifest>{navigation_items}{cover_item}<item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#
        )
    };
    let cover_item =
        r#"<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>"#;
    let cover_page = br#"<html><body><img src="cover.jpg"/></body></html>"#;

    let cases = [
        (
            "multiple cover landmarks",
            base_manifest(
                r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                cover_item,
            ),
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">One</a><a epub:type="cover" href="cover.xhtml">Two</a></nav></body></html>"#
                .as_slice(),
            "multiple cover landmarks",
        ),
        (
            "multiple landmarks navigations",
            base_manifest(
                r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                cover_item,
            ),
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"/><nav epub:type="landmarks"/></body></html>"#
                .as_slice(),
            "multiple landmarks navigation elements",
        ),
        (
            "external landmark target",
            base_manifest(
                r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                cover_item,
            ),
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="https://example.com/cover.xhtml">Cover</a></nav></body></html>"#
                .as_slice(),
            "external, embedded, or unsafe",
        ),
        (
            "malformed navigation",
            base_manifest(
                r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                cover_item,
            ),
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml"></broken>"#
                .as_slice(),
            "navigation document is malformed",
        ),
    ];

    for (label, package, navigation, expected) in cases {
        let error = plan_package(
            &package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", cover_page),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(error.contains(expected), "{label}: {error}");
    }

    let ambiguous_nav_package = base_manifest(
        r#"<item id="navigation-one" href="nav-one.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="navigation-two" href="nav-two.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
        cover_item,
    );
    let error = plan_package(
        &ambiguous_nav_package,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav-one.xhtml", b"<html/>"),
            ("OEBPS/nav-two.xhtml", b"<html/>"),
            ("OEBPS/cover.xhtml", cover_page),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("ambiguous navigation items should fail");
    assert!(error.contains("multiple navigation documents"), "{error}");
}

#[test]
fn missing_or_unmanifested_landmark_resources_fail_safely() {
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

    let missing_nav_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let error = plan_package(
        missing_nav_package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("missing navigation document should fail");
    assert!(error.contains("navigation document resource"), "{error}");
    assert!(error.contains("is missing"), "{error}");

    let missing_target_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let error = plan_package(
        missing_target_package,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("missing landmark target should fail");
    assert!(error.contains("cover page resource"), "{error}");
    assert!(error.contains("is missing"), "{error}");

    let unmanifested_target_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let error = plan_package(
        unmanifested_target_package,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("unmanifested landmark target should fail");
    assert!(error.contains("not tied to a manifest item"), "{error}");
}

#[test]
fn landmark_target_must_be_manifest_backed_xhtml() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.html" media-type="text/html"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let error = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.html">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/cover.html",
                br#"<html><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("non-XHTML landmark target should fail");

    assert!(
        error.contains("does not reference a supported XHTML document"),
        "{error}"
    );
}

#[test]
fn navigation_without_a_cover_landmark_preserves_package_cover_behavior() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine/></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="toc" href="toc.xhtml">Contents</a></nav></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect("package cover should remain usable without a cover landmark");

    assert_eq!(plan.cover_item_id, "cover-resource");
    assert!(plan.existing_cover);
}

#[test]
fn conflicting_landmark_and_package_cover_leave_original_epub_unchanged() {
    let root = test_root();
    fs::create_dir_all(&root).expect("root should be created");
    let epub_path = root.join("book.epub");
    let image_path = root.join("replacement.png");
    write_image(&image_path, 600, 900);
    write_epub(
        &epub_path,
        r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg" properties="cover-image"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
            ),
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
            book_id: "book-landmark-conflict".to_string(),
            image_path: image_path.to_string_lossy().into_owned(),
            framing: EpubCoverFraming::Crop,
            expected_image_size: image_size,
            expected_image_modified_at: image_modified_at,
            expected_epub_size: epub_size,
            expected_epub_modified_at: epub_modified_at,
            keep_successful_backup: false,
        },
    )
    .expect_err("conflicting package and landmark covers should fail");

    assert!(
        error.contains("visible cover page point to different image resources"),
        "{error}"
    );
    assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
    fs::remove_dir_all(root).expect("root should be removed");
}

#[test]
fn harmless_local_cover_stylesheet_is_allowed() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
    let plan = plan_package(
        package,
        CoverImageFormat::Png,
        &[
            (
                "OEBPS/nav.xhtml",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
            ),
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.css", b"html, body { margin: 0; } img { display: block; }"),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect("harmless stylesheet should be accepted");

    assert_eq!(plan.cover_item_id, "cover-resource");
}

#[test]
fn cover_stylesheets_with_image_or_import_dependencies_fail_safely() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
    let cover_page = br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#;

    for (label, css, expected) in [
        (
            "background-image",
            b"body { background-image: url('other.jpg'); }".as_slice(),
            "image resource dependency",
        ),
        (
            "background shorthand",
            b"body { background: center / cover url('other.jpg'); }".as_slice(),
            "image resource dependency",
        ),
        (
            "stylesheet import",
            b"@import url('nested.css'); body { margin: 0; }".as_slice(),
            "imports another stylesheet",
        ),
        (
            "remote URL",
            b"@font-face { src: url('https://example.com/font.woff2'); }".as_slice(),
            "image resource dependency",
        ),
        (
            "data URL",
            b"@font-face { src: url(data:font/woff2;base64,AAAA); }".as_slice(),
            "image resource dependency",
        ),
        (
            "malformed stylesheet",
            b"body { margin: 0;".as_slice(),
            "stylesheet is malformed",
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", cover_page),
                ("OEBPS/cover.css", css),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(error.contains(expected), "{label}: {error}");
    }
}

#[test]
fn external_missing_and_unmanifested_cover_stylesheets_fail_safely() {
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
    let package_with_css = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;

    let external_error = plan_package(
        package_with_css,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><link rel="stylesheet" href="https://example.com/cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("external stylesheet should fail");
    assert!(
        external_error.contains("external, embedded, or unsafe reference"),
        "{external_error}"
    );

    let missing_error = plan_package(
        package_with_css,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("missing stylesheet should fail");
    assert!(missing_error.contains("is missing"), "{missing_error}");

    let package_without_css = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let unmanifested_error = plan_package(
        package_without_css,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            (
                "OEBPS/cover.xhtml",
                br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
            ),
            ("OEBPS/cover.css", b"body { margin: 0; }"),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect_err("unmanifested stylesheet should fail");
    assert!(
        unmanifested_error.contains("not tied to a manifest item"),
        "{unmanifested_error}"
    );
}

#[test]
fn ambiguous_cover_page_rendering_mechanisms_fail_safely() {
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;

    for (label, page, expected) in [
        (
            "picture",
            br#"<html><body><picture><img src="cover.jpg"/></picture></body></html>"#
                .as_slice(),
            "alternative image sources",
        ),
        (
            "source",
            br#"<html><body><source src="cover.jpg"/></body></html>"#.as_slice(),
            "alternative image sources",
        ),
        (
            "srcset",
            br#"<html><body><img src="cover.jpg" srcset="cover@2x.jpg 2x"/></body></html>"#
                .as_slice(),
            "uses srcset",
        ),
        (
            "script",
            br#"<html><body><script>document.write('cover')</script><img src="cover.jpg"/></body></html>"#
                .as_slice(),
            "uses scripting",
        ),
        (
            "iframe",
            br#"<html><body><iframe src="cover.html"/><img src="cover.jpg"/></body></html>"#
                .as_slice(),
            "embedded content",
        ),
        (
            "object",
            br#"<html><body><object data="cover.svg"/><img src="cover.jpg"/></body></html>"#
                .as_slice(),
            "embedded content",
        ),
        (
            "embed",
            br#"<html><body><embed src="cover.svg"/><img src="cover.jpg"/></body></html>"#
                .as_slice(),
            "embedded content",
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", page),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(error.contains(expected), "{label}: {error}");
    }

    for property in ["scripted", "remote-resources"] {
        let package = format!(
            r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" properties="{property}"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#
        );
        let error = plan_package(
            &package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("unsafe manifest property should fail");
        assert!(error.contains(property), "{property}: {error}");
    }
}

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

    let package = super::epub_metadata::read_package_document(&mut archive)
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
    let package = super::epub_metadata::read_package_document(&mut archive)
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

    let package = super::epub_metadata::read_package_document(&mut archive)
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

    let error = super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
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

    let error = super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
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
    let backup_dir = root.join(".archeion/backups");
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
fn navigation_and_cover_documents_reject_base_url_overrides() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="text-cover" href="Text/cover.jpg" media-type="image/jpeg"/><item id="images-cover" href="Images/cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
    let safe_navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#;
    let safe_cover = br#"<html><body><img src="cover.jpg"/></body></html>"#;

    for (label, navigation, cover_page) in [
        (
            "navigation base element",
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><head><base href="Text/"/></head><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
            safe_cover.as_slice(),
        ),
        (
            "navigation empty base element",
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><head><base/></head><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
            safe_cover.as_slice(),
        ),
        (
            "navigation root xml base",
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops" xml:base="Text/"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
            safe_cover.as_slice(),
        ),
        (
            "landmarks xml base",
            br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks" xml:base="Text/"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
            safe_cover.as_slice(),
        ),
        (
            "cover base element",
            safe_navigation.as_slice(),
            br#"<html><head><base href="../Images/"/></head><body><img src="cover.jpg"/></body></html>"#.as_slice(),
        ),
        (
            "cover root xml base",
            safe_navigation.as_slice(),
            br#"<html xml:base="../Images/"><body><img src="cover.jpg"/></body></html>"#.as_slice(),
        ),
        (
            "cover image xml base",
            safe_navigation.as_slice(),
            br#"<html><body><img xml:base="../Images/" src="cover.jpg"/></body></html>"#.as_slice(),
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/Text/cover.xhtml", cover_page),
                ("OEBPS/Text/cover.jpg", b"text-cover"),
                ("OEBPS/Images/cover.jpg", b"images-cover"),
            ],
        )
        .expect_err(label);
        assert!(
            error.contains("document-relative resources cannot be resolved safely"),
            "{label}: {error}"
        );
    }
}

#[test]
fn cover_css_rejects_all_resource_indirection_but_allows_harmless_rules() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
    let linked_page = br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#;

    for (label, css) in [
        (
            "content URL",
            b"img { content: url('actual-cover.jpg'); }".as_slice(),
        ),
        (
            "custom property URL",
            b".cover { --cover-image: url('actual-cover.jpg'); }".as_slice(),
        ),
        (
            "mask image URL",
            b".cover { mask-image: url('mask.png'); }".as_slice(),
        ),
        (
            "border image URL",
            b".cover { border-image-source: url('frame.png'); }".as_slice(),
        ),
        (
            "image set",
            b".cover { background-image: image-set('cover.png' 1x); }".as_slice(),
        ),
        (
            "cross fade",
            b".cover { background-image: cross-fade(cover.png, other.png, 50%); }".as_slice(),
        ),
        (
            "element function",
            b".cover { content: element(#cover); }".as_slice(),
        ),
        (
            "image function",
            b".cover { background: image('cover.png'); }".as_slice(),
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", linked_page),
                ("OEBPS/cover.css", css),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(
            error.contains("image resource dependency"),
            "{label}: {error}"
        );
    }

    plan_package(
        package,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            ("OEBPS/cover.xhtml", linked_page),
            (
                "OEBPS/cover.css",
                b"html, body { margin: 0; } img { display: block; width: 100%; }",
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect("harmless stylesheet should remain supported");
}

#[test]
fn inline_cover_css_resource_indirection_fails_safely() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

    for (label, page) in [
        (
            "style element URL",
            br#"<html><head><style>img { content: url('actual-cover.jpg'); }</style></head><body><img src="cover.jpg"/></body></html>"#.as_slice(),
        ),
        (
            "style attribute URL",
            br#"<html><body><img src="cover.jpg" style="mask-image: url('mask.png')"/></body></html>"#.as_slice(),
        ),
        (
            "style attribute image set",
            br#"<html><body><img src="cover.jpg" style="content: image-set('cover.png' 1x)"/></body></html>"#.as_slice(),
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", page),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(error.contains("image resource dependency"), "{label}: {error}");
    }
}

#[test]
fn cover_page_event_handler_attributes_fail_case_insensitively() {
    let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
    let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

    for (label, page) in [
        (
            "image onload",
            br#"<html><body><img src="cover.jpg" onload="this.src='actual.jpg'"/></body></html>"#
                .as_slice(),
        ),
        (
            "image onerror",
            br#"<html><body><img src="cover.jpg" onerror="this.src='actual.jpg'"/></body></html>"#
                .as_slice(),
        ),
        (
            "parent onload",
            br#"<html><body onload="replaceCover()"><img src="cover.jpg"/></body></html>"#
                .as_slice(),
        ),
        (
            "mixed case handler",
            br#"<html><body><img src="cover.jpg" OnMouseOver="replaceCover()"/></body></html>"#
                .as_slice(),
        ),
    ] {
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", page),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err(label);
        assert!(
            error.contains("event-handler attribute"),
            "{label}: {error}"
        );
    }

    plan_package(
        package,
        CoverImageFormat::Png,
        &[
            ("OEBPS/nav.xhtml", navigation),
            (
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="cover.jpg" alt="Cover"/></body></html>"#,
            ),
            ("OEBPS/cover.jpg", b"cover"),
        ],
    )
    .expect("normal attributes should remain supported");
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
