use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{Read, Seek},
    path::Path,
};

use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use zip::{result::ZipError, ZipArchive};

use super::{epub_file_resource, epub_metadata};

const ENCRYPTION_PATH: &str = "META-INF/encryption.xml";
const ENCRYPTION_READ_LIMIT: u64 = 1024 * 1024;
const NAVIGATION_READ_LIMIT: u64 = 2 * 1024 * 1024;
const TOTAL_INSPECTION_LIMIT: u64 = 6 * 1024 * 1024;
const DIAGNOSTICS_FORMAT_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EpubDiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EpubDiagnosticCode {
    UnreadableZip,
    InspectionLimitExceeded,
    MissingContainer,
    MalformedContainer,
    MissingRootfile,
    UnsafeRootfile,
    MissingPackageDocument,
    MalformedPackageDocument,
    SpineManifestItemMissing,
    UnsafeReadingResource,
    ReadingResourceMissing,
    UnsupportedReadingResource,
    EncryptedReadingResource,
    NoUsableReadingOrder,
    NavigationResourceMissing,
    NavigationResourceUnusable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDiagnosticIssue {
    pub(crate) code: EpubDiagnosticCode,
    pub(crate) severity: EpubDiagnosticSeverity,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) message_inputs: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) resource_path: Option<String>,
}

impl EpubDiagnosticIssue {
    fn error(code: EpubDiagnosticCode) -> Self {
        Self {
            code,
            severity: EpubDiagnosticSeverity::Error,
            message_inputs: BTreeMap::new(),
            resource_path: None,
        }
    }

    fn warning(code: EpubDiagnosticCode) -> Self {
        Self {
            code,
            severity: EpubDiagnosticSeverity::Warning,
            message_inputs: BTreeMap::new(),
            resource_path: None,
        }
    }

    fn input(mut self, key: &str, value: impl Into<String>) -> Self {
        self.message_inputs.insert(key.to_string(), value.into());
        self
    }

    fn resource(mut self, path: impl Into<String>) -> Self {
        self.resource_path = Some(path.into());
        self
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDiagnostics {
    pub(crate) format_version: u8,
    pub(crate) issues: Vec<EpubDiagnosticIssue>,
}

impl EpubDiagnostics {
    pub(crate) fn new(mut issues: Vec<EpubDiagnosticIssue>) -> Self {
        issues.sort_by(|left, right| {
            issue_rank(left.code)
                .cmp(&issue_rank(right.code))
                .then_with(|| left.resource_path.cmp(&right.resource_path))
                .then_with(|| left.message_inputs.cmp(&right.message_inputs))
        });
        Self {
            format_version: DIAGNOSTICS_FORMAT_VERSION,
            issues,
        }
    }

    pub(crate) fn has_current_format(&self) -> bool {
        self.format_version == DIAGNOSTICS_FORMAT_VERSION
    }
}

fn issue_rank(code: EpubDiagnosticCode) -> u8 {
    match code {
        EpubDiagnosticCode::UnreadableZip => 0,
        EpubDiagnosticCode::InspectionLimitExceeded => 1,
        EpubDiagnosticCode::MissingContainer => 2,
        EpubDiagnosticCode::MalformedContainer => 3,
        EpubDiagnosticCode::MissingRootfile => 4,
        EpubDiagnosticCode::UnsafeRootfile => 5,
        EpubDiagnosticCode::MissingPackageDocument => 6,
        EpubDiagnosticCode::MalformedPackageDocument => 7,
        EpubDiagnosticCode::SpineManifestItemMissing => 8,
        EpubDiagnosticCode::UnsafeReadingResource => 9,
        EpubDiagnosticCode::ReadingResourceMissing => 10,
        EpubDiagnosticCode::UnsupportedReadingResource => 11,
        EpubDiagnosticCode::EncryptedReadingResource => 12,
        EpubDiagnosticCode::NoUsableReadingOrder => 13,
        EpubDiagnosticCode::NavigationResourceMissing => 14,
        EpubDiagnosticCode::NavigationResourceUnusable => 15,
    }
}

#[derive(Default)]
struct InspectionBudget {
    consumed: u64,
}

enum EntryReadError {
    Missing,
    ResourceLimit,
    TotalLimit,
    Unreadable,
}

fn read_bounded_text<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
    resource_limit: u64,
    budget: &mut InspectionBudget,
) -> Result<String, EntryReadError> {
    let entry = archive.by_name(path).map_err(|error| match error {
        ZipError::FileNotFound => EntryReadError::Missing,
        _ => EntryReadError::Unreadable,
    })?;
    let size = entry.size();
    if size > resource_limit {
        return Err(EntryReadError::ResourceLimit);
    }
    if budget.consumed.saturating_add(size) > TOTAL_INSPECTION_LIMIT {
        return Err(EntryReadError::TotalLimit);
    }

    let capacity = usize::try_from(size).map_err(|_| EntryReadError::ResourceLimit)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(capacity)
        .map_err(|_| EntryReadError::ResourceLimit)?;
    entry
        .take(resource_limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| EntryReadError::Unreadable)?;
    if bytes.len() as u64 > resource_limit {
        return Err(EntryReadError::ResourceLimit);
    }
    budget.consumed += bytes.len() as u64;
    String::from_utf8(bytes).map_err(|_| EntryReadError::Unreadable)
}

fn validate_xml(xml: &str) -> Result<(), String> {
    let mut reader = Reader::from_str(xml);
    let mut depth = 0_u64;
    let mut saw_element = false;
    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(_) => {
                if saw_element && depth == 0 {
                    return Err("XML contains multiple root elements.".to_string());
                }
                depth += 1;
                saw_element = true;
            }
            Event::Empty(_) => {
                if saw_element && depth == 0 {
                    return Err("XML contains multiple root elements.".to_string());
                }
                saw_element = true;
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| "XML contains an unmatched closing element.".to_string())?;
            }
            Event::Eof if saw_element && depth == 0 => return Ok(()),
            Event::Eof => return Err("XML document is incomplete.".to_string()),
            _ => {}
        }
    }
}

fn supported_reading_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "application/xhtml+xml" | "text/html" | "image/svg+xml"
    )
}

fn entry_exists<R: Read + Seek>(archive: &mut ZipArchive<R>, path: &str) -> bool {
    archive.by_name(path).is_ok()
}

fn encrypted_resources<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    budget: &mut InspectionBudget,
) -> Result<BTreeSet<String>, EntryReadError> {
    let xml = match read_bounded_text(archive, ENCRYPTION_PATH, ENCRYPTION_READ_LIMIT, budget) {
        Err(EntryReadError::Missing) => return Ok(BTreeSet::new()),
        result => result?,
    };
    let mut reader = Reader::from_str(&xml);
    let mut resources = BTreeSet::new();
    loop {
        match reader
            .read_event()
            .map_err(|_| EntryReadError::Unreadable)?
        {
            Event::Start(event) | Event::Empty(event)
                if event.local_name().as_ref() == b"CipherReference" =>
            {
                for attribute in event.attributes() {
                    let attribute = attribute.map_err(|_| EntryReadError::Unreadable)?;
                    if attribute.key.local_name().as_ref() != b"URI" {
                        continue;
                    }
                    let uri = attribute
                        .decoded_and_normalized_value(
                            quick_xml::XmlVersion::Implicit1_0,
                            reader.decoder(),
                        )
                        .map_err(|_| EntryReadError::Unreadable)?;
                    let decoded = epub_metadata::decode_archive_href(&uri);
                    if let Ok(path) = epub_metadata::sanitize_zip_path(&decoded) {
                        resources.insert(path);
                    }
                }
            }
            Event::Eof => return Ok(resources),
            _ => {}
        }
    }
}

fn limit_issue(resource_path: Option<&str>) -> EpubDiagnosticIssue {
    let issue = EpubDiagnosticIssue::error(EpubDiagnosticCode::InspectionLimitExceeded);
    match resource_path {
        Some(path) => issue.resource(path),
        None => issue,
    }
}

pub(crate) fn diagnose_epub(path: &Path) -> EpubDiagnostics {
    match epub_file_resource::validate_epub_file_size(path) {
        Ok(_) => {}
        Err(epub_file_resource::EpubFileResourceError::TooLarge) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::InspectionLimitExceeded,
            )]);
        }
        Err(
            epub_file_resource::EpubFileResourceError::NotFile
            | epub_file_resource::EpubFileResourceError::Unavailable(_),
        ) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::UnreadableZip,
            )]);
        }
    }
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::UnreadableZip,
            )]);
        }
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::UnreadableZip,
            )]);
        }
    };
    diagnose_archive(&mut archive)
}

fn diagnose_archive<R: Read + Seek>(archive: &mut ZipArchive<R>) -> EpubDiagnostics {
    let mut budget = InspectionBudget::default();
    let container = match read_bounded_text(
        archive,
        epub_metadata::CONTAINER_PATH,
        epub_metadata::CONTAINER_READ_LIMIT,
        &mut budget,
    ) {
        Ok(xml) => xml,
        Err(EntryReadError::Missing) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MissingContainer,
            )]);
        }
        Err(EntryReadError::ResourceLimit | EntryReadError::TotalLimit) => {
            return EpubDiagnostics::new(vec![limit_issue(Some(epub_metadata::CONTAINER_PATH))]);
        }
        Err(EntryReadError::Unreadable) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MalformedContainer,
            )]);
        }
    };
    if validate_xml(&container).is_err() {
        return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
            EpubDiagnosticCode::MalformedContainer,
        )]);
    }
    let package_path = match epub_metadata::package_path_from_container(&container) {
        Ok(path) => path,
        Err(epub_metadata::EpubContainerPathError::UnsafeRootfile) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::UnsafeRootfile,
            )]);
        }
        Err(epub_metadata::EpubContainerPathError::MissingRootfile) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MissingRootfile,
            )]);
        }
    };
    let package_xml = match read_bounded_text(
        archive,
        &package_path,
        epub_metadata::PACKAGE_READ_LIMIT,
        &mut budget,
    ) {
        Ok(xml) => xml,
        Err(EntryReadError::Missing) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MissingPackageDocument,
            )
            .resource(package_path)]);
        }
        Err(EntryReadError::ResourceLimit | EntryReadError::TotalLimit) => {
            return EpubDiagnostics::new(vec![limit_issue(Some(&package_path))]);
        }
        Err(EntryReadError::Unreadable) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MalformedPackageDocument,
            )
            .resource(package_path)]);
        }
    };
    if validate_xml(&package_xml).is_err() {
        return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
            EpubDiagnosticCode::MalformedPackageDocument,
        )
        .resource(package_path)]);
    }
    let package = match epub_metadata::parse_package_structure(&package_xml) {
        Ok(package) => package,
        Err(_) => {
            return EpubDiagnostics::new(vec![EpubDiagnosticIssue::error(
                EpubDiagnosticCode::MalformedPackageDocument,
            )
            .resource(package_path)]);
        }
    };

    let mut issues = Vec::new();
    let encrypted = match encrypted_resources(archive, &mut budget) {
        Ok(resources) => resources,
        Err(EntryReadError::ResourceLimit | EntryReadError::TotalLimit) => {
            issues.push(limit_issue(Some(ENCRYPTION_PATH)));
            BTreeSet::new()
        }
        Err(EntryReadError::Missing | EntryReadError::Unreadable) => BTreeSet::new(),
    };
    let mut usable_reading_resources = 0_usize;

    for idref in &package.spine {
        let Some(item) = package.manifest.get(idref) else {
            issues.push(
                EpubDiagnosticIssue::error(EpubDiagnosticCode::SpineManifestItemMissing)
                    .input("manifestId", idref),
            );
            continue;
        };
        let decoded_href = epub_metadata::decode_archive_href(&item.href);
        let resource_path =
            match epub_metadata::resolve_zip_relative_path(&package_path, &decoded_href) {
                Ok(path) => path,
                Err(_) => {
                    issues.push(
                        EpubDiagnosticIssue::error(EpubDiagnosticCode::UnsafeReadingResource)
                            .input("manifestId", &item.id)
                            .resource(item.href.clone()),
                    );
                    continue;
                }
            };
        if !entry_exists(archive, &resource_path) {
            issues.push(
                EpubDiagnosticIssue::error(EpubDiagnosticCode::ReadingResourceMissing)
                    .input("manifestId", &item.id)
                    .resource(resource_path),
            );
            continue;
        }
        if !supported_reading_media_type(&item.media_type) {
            issues.push(
                EpubDiagnosticIssue::error(EpubDiagnosticCode::UnsupportedReadingResource)
                    .input("manifestId", &item.id)
                    .input("mediaType", &item.media_type)
                    .resource(resource_path),
            );
            continue;
        }
        if encrypted.contains(&resource_path) {
            issues.push(
                EpubDiagnosticIssue::error(EpubDiagnosticCode::EncryptedReadingResource)
                    .input("manifestId", &item.id)
                    .resource(resource_path),
            );
            continue;
        }
        usable_reading_resources += 1;
    }

    if usable_reading_resources == 0 {
        issues.push(EpubDiagnosticIssue::error(
            EpubDiagnosticCode::NoUsableReadingOrder,
        ));
    }

    let epub_three_navigation_item = package
        .manifest
        .values()
        .find(|item| item.properties.iter().any(|property| property == "nav"))
        .map(|item| (item, "application/xhtml+xml"));
    let navigation_item = epub_three_navigation_item.or_else(|| {
        package
            .spine_toc
            .as_ref()
            .and_then(|id| package.manifest.get(id))
            .map(|item| (item, "application/x-dtbncx+xml"))
    });
    if let Some((item, expected_media_type)) = navigation_item {
        let decoded_href = epub_metadata::decode_archive_href(&item.href);
        if item.media_type != expected_media_type {
            issues.push(
                EpubDiagnosticIssue::warning(EpubDiagnosticCode::NavigationResourceUnusable)
                    .input("manifestId", &item.id)
                    .input("mediaType", &item.media_type)
                    .resource(item.href.clone()),
            );
        } else {
            match epub_metadata::resolve_zip_relative_path(&package_path, &decoded_href) {
                Err(_) => issues.push(
                    EpubDiagnosticIssue::warning(EpubDiagnosticCode::NavigationResourceUnusable)
                        .input("manifestId", &item.id)
                        .resource(item.href.clone()),
                ),
                Ok(navigation_path) => match read_bounded_text(
                    archive,
                    &navigation_path,
                    NAVIGATION_READ_LIMIT,
                    &mut budget,
                ) {
                    Ok(xml) if validate_xml(&xml).is_ok() => {}
                    Ok(_) | Err(EntryReadError::Unreadable) => issues.push(
                        EpubDiagnosticIssue::warning(
                            EpubDiagnosticCode::NavigationResourceUnusable,
                        )
                        .input("manifestId", &item.id)
                        .resource(navigation_path),
                    ),
                    Err(EntryReadError::Missing) => issues.push(
                        EpubDiagnosticIssue::warning(EpubDiagnosticCode::NavigationResourceMissing)
                            .input("manifestId", &item.id)
                            .resource(navigation_path),
                    ),
                    Err(EntryReadError::ResourceLimit | EntryReadError::TotalLimit) => {
                        issues.push(limit_issue(Some(&navigation_path)))
                    }
                },
            }
        }
    } else if let Some(manifest_id) = package.spine_toc.as_ref() {
        issues.push(
            EpubDiagnosticIssue::warning(EpubDiagnosticCode::NavigationResourceMissing)
                .input("manifestId", manifest_id),
        );
    }

    EpubDiagnostics::new(issues)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{Cursor, Write},
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{
        diagnose_archive, diagnose_epub, read_bounded_text, EntryReadError, EpubDiagnosticCode,
        InspectionBudget, TOTAL_INSPECTION_LIMIT,
    };

    const CONTAINER: &str = r#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#;
    const VALID_PACKAGE: &str = r#"<?xml version="1.0"?><package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
    const XHTML: &str =
        r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body/></html>"#;

    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (path, bytes) in entries {
            writer
                .start_file(*path, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn diagnose_bytes(bytes: Vec<u8>) -> super::EpubDiagnostics {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        diagnose_archive(&mut archive)
    }

    fn codes(bytes: Vec<u8>) -> Vec<EpubDiagnosticCode> {
        diagnose_bytes(bytes)
            .issues
            .into_iter()
            .map(|issue| issue.code)
            .collect()
    }

    #[test]
    fn valid_representative_epub_has_no_structural_issues() {
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", VALID_PACKAGE.as_bytes()),
            ("OEBPS/chapter.xhtml", XHTML.as_bytes()),
            ("OEBPS/nav.xhtml", XHTML.as_bytes()),
        ]));
        assert!(diagnostics.issues.is_empty());
    }

    #[test]
    fn corrupt_and_missing_or_malformed_container_and_package_are_typed() {
        let path = temporary_path("corrupt");
        fs::write(&path, b"not a zip").unwrap();
        assert_eq!(
            diagnose_epub(&path).issues[0].code,
            EpubDiagnosticCode::UnreadableZip
        );
        fs::remove_file(path).unwrap();

        assert_eq!(codes(zip(&[])), vec![EpubDiagnosticCode::MissingContainer]);
        assert_eq!(
            codes(zip(&[("META-INF/container.xml", b"<container>")])),
            vec![EpubDiagnosticCode::MalformedContainer]
        );
        assert_eq!(
            codes(zip(&[(
                "META-INF/container.xml",
                b"<container><rootfiles/></container>",
            )])),
            vec![EpubDiagnosticCode::MissingRootfile]
        );
        assert_eq!(
            codes(zip(&[("META-INF/container.xml", CONTAINER.as_bytes())])),
            vec![EpubDiagnosticCode::MissingPackageDocument]
        );
        assert_eq!(
            codes(zip(&[
                ("META-INF/container.xml", CONTAINER.as_bytes()),
                ("OEBPS/content.opf", b"<package>"),
            ])),
            vec![EpubDiagnosticCode::MalformedPackageDocument]
        );
    }

    #[test]
    fn unsafe_rootfile_and_reading_resource_paths_are_rejected() {
        let unsafe_container = r#"<container><rootfile full-path="../content.opf"/></container>"#;
        assert_eq!(
            codes(zip(&[(
                "META-INF/container.xml",
                unsafe_container.as_bytes(),
            )])),
            vec![EpubDiagnosticCode::UnsafeRootfile]
        );

        let package = r#"<package><manifest><item id="chapter" href="../../chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        assert_eq!(
            codes(zip(&[
                ("META-INF/container.xml", CONTAINER.as_bytes()),
                ("OEBPS/content.opf", package.as_bytes()),
            ])),
            vec![
                EpubDiagnosticCode::UnsafeReadingResource,
                EpubDiagnosticCode::NoUsableReadingOrder,
            ]
        );
    }

    #[test]
    fn missing_manifest_reading_and_navigation_resources_are_reported_in_order() {
        let package = r#"<package><manifest><item id="chapter" href="missing.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="unknown"/><itemref idref="chapter"/></spine></package>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
        ]));
        assert_eq!(
            diagnostics
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![
                EpubDiagnosticCode::SpineManifestItemMissing,
                EpubDiagnosticCode::ReadingResourceMissing,
                EpubDiagnosticCode::NoUsableReadingOrder,
                EpubDiagnosticCode::NavigationResourceMissing,
            ]
        );
        assert_eq!(
            diagnostics.issues[1].resource_path.as_deref(),
            Some("OEBPS/missing.xhtml")
        );
    }

    #[test]
    fn malformed_declared_navigation_resource_is_unusable() {
        assert_eq!(
            codes(zip(&[
                ("META-INF/container.xml", CONTAINER.as_bytes()),
                ("OEBPS/content.opf", VALID_PACKAGE.as_bytes()),
                ("OEBPS/chapter.xhtml", XHTML.as_bytes()),
                ("OEBPS/nav.xhtml", b"<html>"),
            ])),
            vec![EpubDiagnosticCode::NavigationResourceUnusable]
        );
    }

    #[test]
    fn missing_epub_two_navigation_manifest_item_preserves_declared_id() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", XHTML.as_bytes()),
        ]));

        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(
            diagnostics.issues[0].code,
            EpubDiagnosticCode::NavigationResourceMissing
        );
        assert_eq!(
            diagnostics.issues[0].message_inputs.get("manifestId"),
            Some(&"ncx".to_string())
        );
        assert_eq!(diagnostics.issues[0].resource_path, None);
    }

    #[test]
    fn unsupported_and_encrypted_reading_resources_block_normal_reading() {
        let package = r#"<package><manifest><item id="audio" href="audio.mp3" media-type="audio/mpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="audio"/><itemref idref="chapter"/></spine></package>"#;
        let encryption = r#"<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/chapter.xhtml"/></CipherData></EncryptedData></encryption>"#;
        assert_eq!(
            codes(zip(&[
                ("META-INF/container.xml", CONTAINER.as_bytes()),
                ("META-INF/encryption.xml", encryption.as_bytes()),
                ("OEBPS/content.opf", package.as_bytes()),
                ("OEBPS/audio.mp3", b"audio"),
                ("OEBPS/chapter.xhtml", XHTML.as_bytes()),
            ])),
            vec![
                EpubDiagnosticCode::UnsupportedReadingResource,
                EpubDiagnosticCode::EncryptedReadingResource,
                EpubDiagnosticCode::NoUsableReadingOrder,
            ]
        );
    }

    #[test]
    fn per_resource_limit_stops_oversized_container_inspection() {
        let oversized = vec![b'x'; super::epub_metadata::CONTAINER_READ_LIMIT as usize + 1];
        assert_eq!(
            codes(zip(&[("META-INF/container.xml", &oversized)])),
            vec![EpubDiagnosticCode::InspectionLimitExceeded]
        );
    }

    #[test]
    fn total_budget_stops_additional_resource_inspection() {
        let bytes = zip(&[("resource.xml", b"<root/>")]);
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut budget = InspectionBudget {
            consumed: TOTAL_INSPECTION_LIMIT,
        };
        assert!(matches!(
            read_bounded_text(&mut archive, "resource.xml", 1024, &mut budget),
            Err(EntryReadError::TotalLimit)
        ));
    }

    #[test]
    fn issue_order_is_stable_across_manifest_and_spine_order() {
        let first = r#"<package><manifest><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>"#;
        let second = r#"<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>"#;
        let diagnostics = |package: &str| {
            diagnose_bytes(zip(&[
                ("META-INF/container.xml", CONTAINER.as_bytes()),
                ("OEBPS/content.opf", package.as_bytes()),
            ]))
        };
        assert_eq!(diagnostics(first), diagnostics(second));
    }

    fn temporary_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-diagnostics-{label}-{nonce}.epub"))
    }
}
