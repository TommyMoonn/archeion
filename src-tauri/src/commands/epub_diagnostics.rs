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
const LINK_DOCUMENT_READ_LIMIT: u64 = 2 * 1024 * 1024;
const TOTAL_LINK_DOCUMENT_BYTES_LIMIT: u64 = 16 * 1024 * 1024;
const LINK_DOCUMENT_LIMIT: usize = 128;
const LINKS_PER_DOCUMENT_LIMIT: usize = 2_048;
const TOTAL_LINKS_LIMIT: usize = 8_192;
const MESSAGE_INPUT_CHARACTER_LIMIT: usize = 256;
const DIAGNOSTICS_FORMAT_VERSION: u8 = 2;

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
    BrokenLocalDocumentTarget,
    UnsafeLocalLinkTarget,
    InvalidLocalLinkTarget,
    ReadableDocumentUnusable,
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
        let value = value.into();
        let concise_value = value
            .char_indices()
            .nth(MESSAGE_INPUT_CHARACTER_LIMIT)
            .map_or(value.as_str(), |(index, _)| &value[..index]);
        self.message_inputs
            .insert(key.to_string(), concise_value.to_string());
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
        EpubDiagnosticCode::BrokenLocalDocumentTarget => 16,
        EpubDiagnosticCode::UnsafeLocalLinkTarget => 17,
        EpubDiagnosticCode::InvalidLocalLinkTarget => 18,
        EpubDiagnosticCode::ReadableDocumentUnusable => 19,
    }
}

struct InspectionBudget {
    consumed: u64,
    limit: u64,
}

impl InspectionBudget {
    fn new(limit: u64) -> Self {
        Self { consumed: 0, limit }
    }
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
    if budget.consumed.saturating_add(size) > budget.limit {
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

#[derive(Clone)]
struct ParsedLinkDocument {
    fragments: BTreeSet<String>,
    links: Vec<String>,
}

#[derive(Clone)]
enum LinkDocumentInspection {
    Parsed(ParsedLinkDocument),
    Malformed,
    ResourceLimitExceeded,
    GlobalLimitExceeded,
    Missing,
}

enum LinkTarget {
    External,
    Invalid,
    Unsafe,
    Local {
        fragment: Option<String>,
        path: String,
    },
}

enum ReaderLocalTargetKind {
    Document,
    Illustration,
}

fn reader_local_target_kind(path: &str) -> Option<ReaderLocalTargetKind> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "htm" | "html" | "xht" | "xhtml" => Some(ReaderLocalTargetKind::Document),
        "avif" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp" => {
            Some(ReaderLocalTargetKind::Illustration)
        }
        _ => None,
    }
}

fn has_uri_scheme(value: &str) -> bool {
    value.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty()
            && scheme.chars().enumerate().all(|(index, character)| {
                if index == 0 {
                    character.is_ascii_alphabetic()
                } else {
                    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
                }
            })
    })
}

fn has_valid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return false;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    true
}

fn resolve_link_target(source_path: &str, href: &str) -> LinkTarget {
    let href = href.trim();
    if href.chars().any(char::is_control) {
        return LinkTarget::Invalid;
    }
    if href.starts_with("//") || has_uri_scheme(href) {
        return LinkTarget::External;
    }
    if href.starts_with('/') || href.starts_with('\\') {
        return LinkTarget::Unsafe;
    }
    if href.is_empty() || href.contains('?') || !has_valid_percent_encoding(href) {
        return LinkTarget::Invalid;
    }

    let (document_href, fragment) = href
        .split_once('#')
        .map_or((href, None), |(document, fragment)| {
            (document, (!fragment.is_empty()).then_some(fragment))
        });
    let decoded_fragment = fragment.map(epub_metadata::decode_archive_href);
    if decoded_fragment
        .as_ref()
        .is_some_and(|value| value.contains('\u{fffd}') || value.chars().any(char::is_control))
    {
        return LinkTarget::Invalid;
    }
    let path = if document_href.is_empty() {
        source_path.to_string()
    } else {
        let decoded_href = epub_metadata::decode_archive_href(document_href);
        if decoded_href.contains('\u{fffd}') || decoded_href.chars().any(char::is_control) {
            return LinkTarget::Invalid;
        }
        if decoded_href.starts_with('/') || decoded_href.starts_with('\\') {
            return LinkTarget::Unsafe;
        }
        if has_uri_scheme(&decoded_href) {
            return LinkTarget::Invalid;
        }
        match epub_metadata::resolve_zip_relative_path(source_path, &decoded_href) {
            Ok(path) => path,
            Err(_) => return LinkTarget::Unsafe,
        }
    };
    LinkTarget::Local {
        fragment: decoded_fragment,
        path,
    }
}

fn collect_link_document_element(
    event: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<&[u8]>,
    fragments: &mut BTreeSet<String>,
    links: &mut Vec<String>,
) -> Result<(), EntryReadError> {
    let local_name = event.local_name();
    let is_link = matches!(local_name.as_ref(), b"a" | b"area");
    for attribute in event.attributes() {
        let attribute = attribute.map_err(|_| EntryReadError::Unreadable)?;
        let name = attribute.key.local_name();
        let name = name.as_ref();
        if name != b"id" && name != b"name" && !(is_link && name == b"href") {
            continue;
        }
        let value = attribute
            .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|_| EntryReadError::Unreadable)?
            .into_owned();
        if is_link && name == b"href" {
            if links.len() == LINKS_PER_DOCUMENT_LIMIT {
                return Err(EntryReadError::ResourceLimit);
            }
            links.push(value);
        } else if !value.is_empty() {
            fragments.insert(value);
        }
    }
    Ok(())
}

fn requires_balanced_link_xml(path: &str) -> bool {
    !path
        .rsplit_once('.')
        .is_some_and(|(_, extension)| extension.eq_ignore_ascii_case("html"))
}

fn parse_link_document(
    xml: &str,
    require_balanced_xml: bool,
) -> Result<ParsedLinkDocument, EntryReadError> {
    let mut reader = Reader::from_str(xml);
    let mut depth = 0_u64;
    let mut saw_element = false;
    let mut fragments = BTreeSet::new();
    let mut links = Vec::new();

    loop {
        match reader
            .read_event()
            .map_err(|_| EntryReadError::Unreadable)?
        {
            Event::Start(event) => {
                if require_balanced_xml && saw_element && depth == 0 {
                    return Err(EntryReadError::Unreadable);
                }
                saw_element = true;
                collect_link_document_element(&event, &reader, &mut fragments, &mut links)?;
                depth += 1;
            }
            Event::Empty(event) => {
                if require_balanced_xml && saw_element && depth == 0 {
                    return Err(EntryReadError::Unreadable);
                }
                saw_element = true;
                collect_link_document_element(&event, &reader, &mut fragments, &mut links)?;
            }
            Event::End(_) => {
                depth = if require_balanced_xml {
                    depth.checked_sub(1).ok_or(EntryReadError::Unreadable)?
                } else {
                    depth.saturating_sub(1)
                };
            }
            Event::Eof if saw_element && (!require_balanced_xml || depth == 0) => {
                return Ok(ParsedLinkDocument { fragments, links });
            }
            Event::Eof => return Err(EntryReadError::Unreadable),
            _ => {}
        }
    }
}

fn inspect_link_document<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
    budget: &mut InspectionBudget,
    inspected_documents: &mut usize,
) -> LinkDocumentInspection {
    if *inspected_documents == LINK_DOCUMENT_LIMIT {
        return LinkDocumentInspection::GlobalLimitExceeded;
    }
    *inspected_documents += 1;
    match read_bounded_text(archive, path, LINK_DOCUMENT_READ_LIMIT, budget) {
        Ok(xml) => match parse_link_document(&xml, requires_balanced_link_xml(path)) {
            Ok(document) => LinkDocumentInspection::Parsed(document),
            Err(EntryReadError::ResourceLimit) => LinkDocumentInspection::ResourceLimitExceeded,
            Err(EntryReadError::TotalLimit) => LinkDocumentInspection::GlobalLimitExceeded,
            Err(EntryReadError::Missing | EntryReadError::Unreadable) => {
                LinkDocumentInspection::Malformed
            }
        },
        Err(EntryReadError::Missing) => LinkDocumentInspection::Missing,
        Err(EntryReadError::ResourceLimit) => LinkDocumentInspection::ResourceLimitExceeded,
        Err(EntryReadError::TotalLimit) => LinkDocumentInspection::GlobalLimitExceeded,
        Err(EntryReadError::Unreadable) => LinkDocumentInspection::Malformed,
    }
}

fn local_link_issue(
    code: EpubDiagnosticCode,
    source_path: &str,
    href: &str,
) -> EpubDiagnosticIssue {
    EpubDiagnosticIssue::warning(code)
        .input("href", href)
        .resource(source_path)
}

fn inspect_reading_order_links<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    reading_resource_paths: &BTreeSet<String>,
) -> Vec<EpubDiagnosticIssue> {
    let mut issues = Vec::new();
    let mut budget = InspectionBudget::new(TOTAL_LINK_DOCUMENT_BYTES_LIMIT);
    let mut inspected_documents = 0_usize;
    let mut documents = BTreeMap::new();

    for path in reading_resource_paths {
        let inspection =
            inspect_link_document(archive, path, &mut budget, &mut inspected_documents);
        match &inspection {
            LinkDocumentInspection::Malformed => issues.push(
                EpubDiagnosticIssue::warning(EpubDiagnosticCode::ReadableDocumentUnusable)
                    .resource(path),
            ),
            LinkDocumentInspection::ResourceLimitExceeded => issues.push(limit_issue(Some(path))),
            LinkDocumentInspection::GlobalLimitExceeded => {
                issues.push(limit_issue(Some(path)));
                break;
            }
            LinkDocumentInspection::Parsed(_) | LinkDocumentInspection::Missing => {}
        }
        documents.insert(path.clone(), inspection);
    }

    let mut inspected_links = 0_usize;
    for source_path in reading_resource_paths {
        let Some(LinkDocumentInspection::Parsed(source)) = documents.get(source_path) else {
            continue;
        };
        let links = source.links.clone();
        for href in links {
            if inspected_links == TOTAL_LINKS_LIMIT {
                issues.push(limit_issue(Some(source_path)));
                return issues;
            }
            inspected_links += 1;
            match resolve_link_target(source_path, &href) {
                LinkTarget::External => {}
                LinkTarget::Invalid => issues.push(local_link_issue(
                    EpubDiagnosticCode::InvalidLocalLinkTarget,
                    source_path,
                    &href,
                )),
                LinkTarget::Unsafe => issues.push(local_link_issue(
                    EpubDiagnosticCode::UnsafeLocalLinkTarget,
                    source_path,
                    &href,
                )),
                LinkTarget::Local { fragment, path } => {
                    if !entry_exists(archive, &path) {
                        issues.push(
                            local_link_issue(
                                EpubDiagnosticCode::BrokenLocalDocumentTarget,
                                source_path,
                                &href,
                            )
                            .input("targetPath", path),
                        );
                        continue;
                    }
                    match reader_local_target_kind(&path) {
                        Some(ReaderLocalTargetKind::Document) => {}
                        Some(ReaderLocalTargetKind::Illustration) if fragment.is_none() => {
                            continue;
                        }
                        Some(ReaderLocalTargetKind::Illustration) | None => {
                            issues.push(
                                local_link_issue(
                                    EpubDiagnosticCode::InvalidLocalLinkTarget,
                                    source_path,
                                    &href,
                                )
                                .input("targetPath", path),
                            );
                            continue;
                        }
                    }
                    let Some(fragment) = fragment else {
                        continue;
                    };
                    let target = if let Some(target) = documents.get(&path) {
                        target.clone()
                    } else {
                        let target = inspect_link_document(
                            archive,
                            &path,
                            &mut budget,
                            &mut inspected_documents,
                        );
                        documents.insert(path.clone(), target.clone());
                        target
                    };
                    match target {
                        LinkDocumentInspection::Parsed(target)
                            if target.fragments.contains(&fragment) => {}
                        LinkDocumentInspection::ResourceLimitExceeded => {
                            issues.push(limit_issue(Some(&path)))
                        }
                        LinkDocumentInspection::GlobalLimitExceeded => {
                            issues.push(limit_issue(Some(&path)));
                            return issues;
                        }
                        LinkDocumentInspection::Missing => issues.push(
                            local_link_issue(
                                EpubDiagnosticCode::BrokenLocalDocumentTarget,
                                source_path,
                                &href,
                            )
                            .input("targetPath", path),
                        ),
                        LinkDocumentInspection::Parsed(_) | LinkDocumentInspection::Malformed => {
                            issues.push(
                                local_link_issue(
                                    EpubDiagnosticCode::InvalidLocalLinkTarget,
                                    source_path,
                                    &href,
                                )
                                .input("targetPath", path)
                                .input("fragment", fragment),
                            )
                        }
                    }
                }
            }
        }
    }
    issues
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
    let mut budget = InspectionBudget::new(TOTAL_INSPECTION_LIMIT);
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
    let mut readable_resource_paths = BTreeSet::new();

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
        readable_resource_paths.insert(resource_path);
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

    issues.extend(inspect_reading_order_links(
        archive,
        &readable_resource_paths,
    ));

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
        assert!(diagnostics.has_current_format());
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
    fn broken_local_document_target_reports_source_and_resolved_target() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let chapter = r#"<html><body><a href="missing.xhtml">Missing</a></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
        ]));

        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(
            diagnostics.issues[0].code,
            EpubDiagnosticCode::BrokenLocalDocumentTarget
        );
        assert_eq!(
            diagnostics.issues[0].resource_path.as_deref(),
            Some("OEBPS/chapter.xhtml")
        );
        assert_eq!(
            diagnostics.issues[0].message_inputs.get("targetPath"),
            Some(&"OEBPS/missing.xhtml".to_string())
        );
    }

    #[test]
    fn area_link_to_missing_local_document_is_reported() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let chapter =
            r#"<html><body><map><area href="missing.xhtml" alt="Missing"/></map></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
        ]));

        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(
            diagnostics.issues[0].code,
            EpubDiagnosticCode::BrokenLocalDocumentTarget
        );
        assert_eq!(
            diagnostics.issues[0].message_inputs.get("targetPath"),
            Some(&"OEBPS/missing.xhtml".to_string())
        );
    }

    #[test]
    fn existing_unsupported_local_resource_is_invalid_but_supported_illustration_is_valid() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="video" href="media/clip.mp4" media-type="video/mp4"/><item id="plate" href="images/plate.png" media-type="image/png"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let chapter = r#"<html><body><a href="media/clip.mp4">Video</a><a href="images/plate.png">Plate</a></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
            ("OEBPS/media/clip.mp4", b"video"),
            ("OEBPS/images/plate.png", b"png"),
        ]));

        assert_eq!(diagnostics.issues.len(), 1);
        assert_eq!(
            diagnostics.issues[0].code,
            EpubDiagnosticCode::InvalidLocalLinkTarget
        );
        assert_eq!(
            diagnostics.issues[0].message_inputs.get("targetPath"),
            Some(&"OEBPS/media/clip.mp4".to_string())
        );
    }

    #[test]
    fn valid_local_documents_and_fragments_and_external_links_are_unreported() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="target" href="target.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let chapter = r##"<html><body id="self"><a href="#self">Self</a><a href="target.xhtml#note">Target</a><a href="https://example.com/source">Web</a><a href="mailto:reader@example.com">Mail</a></body></html>"##;
        let target = r#"<html><body><aside id="note">Note</aside></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
            ("OEBPS/target.xhtml", target.as_bytes()),
        ]));

        assert!(diagnostics.issues.is_empty());
    }

    #[test]
    fn unsafe_traversal_and_invalid_local_fragments_are_typed_separately() {
        let package = r#"<package><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="target" href="Text/target.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let chapter = r#"<html><body><a href="../../../outside.xhtml">Outside</a><a href="target.xhtml#missing">Missing fragment</a><a href="target.xhtml#bad%ZZ">Malformed fragment</a></body></html>"#;
        let target = r#"<html><body id="present"/></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/Text/chapter.xhtml", chapter.as_bytes()),
            ("OEBPS/Text/target.xhtml", target.as_bytes()),
        ]));

        assert_eq!(
            diagnostics
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![
                EpubDiagnosticCode::UnsafeLocalLinkTarget,
                EpubDiagnosticCode::InvalidLocalLinkTarget,
                EpubDiagnosticCode::InvalidLocalLinkTarget,
            ]
        );
    }

    #[test]
    fn malformed_readable_document_does_not_discard_other_link_issues() {
        let package = r#"<package><manifest><item id="broken" href="broken.xhtml" media-type="application/xhtml+xml"/><item id="valid" href="valid.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="broken"/><itemref idref="valid"/></spine></package>"#;
        let valid = r#"<html><body><a href="missing.xhtml">Missing</a></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/broken.xhtml", b"<html><body>"),
            ("OEBPS/valid.xhtml", valid.as_bytes()),
        ]));

        assert_eq!(
            diagnostics
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![
                EpubDiagnosticCode::BrokenLocalDocumentTarget,
                EpubDiagnosticCode::ReadableDocumentUnusable,
            ]
        );
    }

    #[test]
    fn excessive_links_stop_at_the_per_document_limit() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let mut chapter = String::from("<html><body>");
        for index in 0..=super::LINKS_PER_DOCUMENT_LIMIT {
            chapter.push_str(&format!(r#"<a href="target-{index}.xhtml">Link</a>"#));
        }
        chapter.push_str("</body></html>");
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
        ]));

        assert_eq!(
            diagnostics
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![EpubDiagnosticCode::InspectionLimitExceeded]
        );
    }

    #[test]
    fn structural_and_link_issues_share_deterministic_ordering() {
        let package = r#"<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>"#;
        let chapter = r#"<html><body><a href="missing.xhtml">Missing</a><a href="../../outside.xhtml">Outside</a></body></html>"#;
        let diagnostics = diagnose_bytes(zip(&[
            ("META-INF/container.xml", CONTAINER.as_bytes()),
            ("OEBPS/content.opf", package.as_bytes()),
            ("OEBPS/chapter.xhtml", chapter.as_bytes()),
        ]));

        assert_eq!(
            diagnostics
                .issues
                .iter()
                .map(|issue| issue.code)
                .collect::<Vec<_>>(),
            vec![
                EpubDiagnosticCode::NavigationResourceMissing,
                EpubDiagnosticCode::BrokenLocalDocumentTarget,
                EpubDiagnosticCode::UnsafeLocalLinkTarget,
            ]
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
            limit: TOTAL_INSPECTION_LIMIT,
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
