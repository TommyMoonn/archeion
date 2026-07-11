use std::{
    collections::{HashMap, HashSet},
    time::{SystemTime, UNIX_EPOCH},
};

use quick_xml::{
    events::{BytesEnd, BytesStart, Event},
    Reader, Writer,
};

use super::{
    super::epub_metadata,
    types::{
        href_extension_matches_format, output_format_for_package, CoverImageFormat,
        EpubPackageVersion,
    },
    xml::{attributes_map, local_attribute, ordered_attributes},
};

const PACKAGE_COVER_ID_BASE: &str = "archeion-cover-image";
const PACKAGE_COVER_FILE_BASE: &str = "archeion-cover";

#[derive(Clone, Debug)]
pub(super) struct ManifestItem {
    pub(super) id: String,
    pub(super) href: String,
    pub(super) media_type: String,
    pub(super) properties: Vec<String>,
}

#[derive(Clone, Debug)]
pub(super) struct PackageManifest {
    pub(super) version: EpubPackageVersion,
    pub(super) items: Vec<ManifestItem>,
    pub(super) cover_meta_ids: Vec<String>,
    pub(super) guide_cover_hrefs: Vec<String>,
}

#[derive(Clone, Debug)]
pub(super) struct CoverPackagePlan {
    pub(super) package_version: EpubPackageVersion,
    pub(super) cover_item_id: String,
    pub(super) cover_href: String,
    pub(super) cover_zip_path: String,
    pub(super) output_format: CoverImageFormat,
    pub(super) existing_cover: bool,
    pub(super) existing_media_type: Option<String>,
    pub(super) had_cover_meta: bool,
    pub(super) had_cover_property: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CoverPageRelationship {
    pub(super) page_item_id: String,
    pub(super) image_item_id: String,
}

pub(super) fn manifest_item_has_property(item: &ManifestItem, expected: &str) -> bool {
    item.properties
        .iter()
        .any(|property| property.eq_ignore_ascii_case(expected))
}

pub(super) fn package_manifest(package_xml: &str) -> Result<PackageManifest, String> {
    let mut reader = Reader::from_str(package_xml);
    let mut package_version = None;
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_guide = false;
    let mut manifest_items = Vec::new();
    let mut cover_meta_ids = Vec::new();
    let mut guide_cover_hrefs = Vec::new();

    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(event) => {
                let local_name = event.local_name();
                match local_name.as_ref() {
                    b"package" if package_version.is_none() => {
                        let attributes = attributes_map(&reader, &event);
                        let version = local_attribute(&attributes, "version")
                            .ok_or_else(|| "EPUB package version is missing.".to_string())?;
                        package_version = Some(EpubPackageVersion::parse(version)?);
                    }
                    b"metadata" => in_metadata = true,
                    b"manifest" => in_manifest = true,
                    b"guide" => in_guide = true,
                    b"item" if in_manifest => {
                        manifest_items.push(parse_manifest_item(&reader, &event)?);
                    }
                    b"meta" if in_metadata => {
                        collect_cover_meta(&reader, &event, &mut cover_meta_ids)?;
                    }
                    b"reference" if in_guide => {
                        collect_guide_cover_href(&reader, &event, &mut guide_cover_hrefs)?;
                    }
                    _ => {}
                }
            }
            Event::Empty(event) => match event.local_name().as_ref() {
                b"item" if in_manifest => {
                    manifest_items.push(parse_manifest_item(&reader, &event)?);
                }
                b"meta" if in_metadata => {
                    collect_cover_meta(&reader, &event, &mut cover_meta_ids)?;
                }
                b"reference" if in_guide => {
                    collect_guide_cover_href(&reader, &event, &mut guide_cover_hrefs)?;
                }
                _ => {}
            },
            Event::End(event) => match event.local_name().as_ref() {
                b"metadata" => in_metadata = false,
                b"manifest" => in_manifest = false,
                b"guide" => in_guide = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    let version =
        package_version.ok_or_else(|| "EPUB package element was not found.".to_string())?;
    if manifest_items.is_empty() {
        return Err("EPUB manifest is missing or empty.".to_string());
    }
    Ok(PackageManifest {
        version,
        items: manifest_items,
        cover_meta_ids,
        guide_cover_hrefs,
    })
}

pub(super) fn parse_manifest_item(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<ManifestItem, String> {
    let attributes = attributes_map(reader, event);
    let id = local_attribute(&attributes, "id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "An EPUB manifest item is missing its id.".to_string())?;
    let href = local_attribute(&attributes, "href")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("EPUB manifest item \"{id}\" is missing its href."))?;
    let media_type = local_attribute(&attributes, "media-type")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let properties = local_attribute(&attributes, "properties")
        .map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();
    Ok(ManifestItem {
        id,
        href,
        media_type,
        properties,
    })
}

pub(super) fn collect_cover_meta(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    cover_meta_ids: &mut Vec<String>,
) -> Result<(), String> {
    let attributes = attributes_map(reader, event);
    let is_cover = local_attribute(&attributes, "name")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("cover"));
    if !is_cover {
        return Ok(());
    }
    let content = local_attribute(&attributes, "content")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "EPUB cover metadata is missing its manifest item reference.".to_string())?;
    cover_meta_ids.push(content);
    Ok(())
}

pub(super) fn collect_guide_cover_href(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    guide_cover_hrefs: &mut Vec<String>,
) -> Result<(), String> {
    let attributes = attributes_map(reader, event);
    let is_cover = local_attribute(&attributes, "type").is_some_and(|value| {
        value
            .split_whitespace()
            .any(|token| token.eq_ignore_ascii_case("cover"))
    });
    if !is_cover {
        return Ok(());
    }
    let href = local_attribute(&attributes, "href")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "EPUB cover guide reference is missing its href.".to_string())?;
    guide_cover_hrefs.push(href);
    Ok(())
}

pub(super) fn unique_manifest_id(items: &[ManifestItem]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for item in items {
        if !ids.insert(item.id.as_str()) {
            return Err(format!("EPUB manifest id \"{}\" is duplicated.", item.id));
        }
    }
    Ok(())
}

pub(super) fn unique_value(base: &str, used: &HashSet<String>) -> String {
    if !used.contains(base) {
        return base.to_string();
    }
    for suffix in 2..=10_000 {
        let candidate = format!("{base}-{suffix}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!(
        "{base}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default()
    )
}

pub(super) fn unique_cover_href(extension: &str, used: &HashSet<String>) -> String {
    let base = format!("images/{PACKAGE_COVER_FILE_BASE}.{extension}");
    if !used.contains(&base) {
        return base;
    }
    for suffix in 2..=10_000 {
        let candidate = format!("images/{PACKAGE_COVER_FILE_BASE}-{suffix}.{extension}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!(
        "images/{PACKAGE_COVER_FILE_BASE}-{}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default(),
        extension
    )
}

pub(super) fn is_non_local_reference(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.starts_with('#')
    {
        return true;
    }

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

fn archive_entry_count(archive_name_counts: &HashMap<&str, usize>, path: &str) -> usize {
    archive_name_counts.get(path).copied().unwrap_or_default()
}

pub(super) fn require_unique_archive_entry(
    archive_name_counts: &HashMap<&str, usize>,
    path: &str,
    resource_label: &str,
) -> Result<(), String> {
    match archive_entry_count(archive_name_counts, path) {
        1 => Ok(()),
        0 => Err(format!(
            "The EPUB {resource_label} \"{path}\" is missing. The file was not modified."
        )),
        _ => Err(format!(
            "The EPUB {resource_label} \"{path}\" appears more than once in the archive. The file was not modified."
        )),
    }
}

pub(super) fn resolve_local_document_path(
    base_path: &str,
    href: &str,
    resource_label: &str,
) -> Result<String, String> {
    let href = href.trim();
    if is_non_local_reference(href) {
        return Err(format!(
            "The EPUB {resource_label} uses an external, embedded, or unsafe reference. The file was not modified."
        ));
    }
    let document_href = href.split('#').next().unwrap_or_default();
    if document_href.is_empty() || document_href.contains('?') {
        return Err(format!(
            "The EPUB {resource_label} uses an unsupported reference. The file was not modified."
        ));
    }
    let decoded_href = epub_metadata::decode_archive_href(document_href);
    epub_metadata::resolve_zip_relative_path(base_path, &decoded_href).map_err(|error| {
        format!(
            "The EPUB {resource_label} is outside the package or could not be resolved safely. The file was not modified. {error}"
        )
    })
}

pub(super) fn plan_cover_package<R>(
    package_path: &str,
    package_xml: &str,
    archive_names: &[String],
    source_format: CoverImageFormat,
    mut resolve_cover_page_relationships: R,
) -> Result<CoverPackagePlan, String>
where
    R: FnMut(
        &PackageManifest,
        &HashMap<&str, usize>,
    ) -> Result<Option<CoverPageRelationship>, String>,
{
    let manifest = package_manifest(package_xml)?;
    unique_manifest_id(&manifest.items)?;
    let item_by_id = manifest
        .items
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<HashMap<_, _>>();
    let property_ids = manifest
        .items
        .iter()
        .filter(|item| manifest_item_has_property(item, "cover-image"))
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let mut active_ids = manifest.cover_meta_ids.clone();
    active_ids.extend(property_ids.iter().cloned());
    active_ids.sort();
    active_ids.dedup();

    for id in &manifest.cover_meta_ids {
        if !item_by_id.contains_key(id.as_str()) {
            return Err(format!(
                "EPUB cover metadata references missing manifest item \"{id}\". The file was not modified."
            ));
        }
    }
    if active_ids.len() > 1 {
        return Err(
            "The EPUB declares multiple active cover resources. Resolve the package references before replacing the cover."
                .to_string(),
        );
    }

    let archive_name_counts = archive_names
        .iter()
        .fold(HashMap::new(), |mut counts, name| {
            *counts.entry(name.as_str()).or_insert(0_usize) += 1;
            counts
        });
    let cover_page_relationship =
        resolve_cover_page_relationships(&manifest, &archive_name_counts)?;
    if active_ids
        .first()
        .zip(cover_page_relationship.as_ref())
        .is_some_and(|(active_id, relationship)| active_id != &relationship.image_item_id)
    {
        return Err(
            "The EPUB cover declaration and visible cover page point to different image resources. The file was not modified."
                .to_string(),
        );
    }
    let selected_cover_id = active_ids
        .first()
        .cloned()
        .or_else(|| cover_page_relationship.map(|relationship| relationship.image_item_id));

    if let Some(active_id) = selected_cover_id {
        let item = item_by_id
            .get(active_id.as_str())
            .ok_or_else(|| "The EPUB cover manifest item is unavailable.".to_string())?;
        let existing_format = CoverImageFormat::from_media_type(&item.media_type).ok_or_else(|| {
            let media_type = if item.media_type.is_empty() {
                "a missing media type"
            } else {
                item.media_type.as_str()
            };
            format!(
                "The active EPUB cover uses unsupported media type \"{media_type}\". The file was not modified."
            )
        })?;
        if !href_extension_matches_format(&item.href, existing_format) {
            return Err(
                "The active EPUB cover href extension does not match its declared media type. The file was not modified."
                    .to_string(),
            );
        }
        let output_format =
            output_format_for_package(manifest.version, source_format, Some(existing_format))?;
        let decoded_href = epub_metadata::decode_archive_href(&item.href);
        if is_non_local_reference(&decoded_href) {
            return Err(
                "The active EPUB cover uses an external or unsafe href. The file was not modified."
                    .to_string(),
            );
        }
        let cover_zip_path = epub_metadata::resolve_zip_relative_path(package_path, &decoded_href)?;
        require_unique_archive_entry(&archive_name_counts, &cover_zip_path, "cover resource")?;
        return Ok(CoverPackagePlan {
            package_version: manifest.version,
            cover_item_id: item.id.clone(),
            cover_href: item.href.clone(),
            cover_zip_path,
            output_format,
            existing_cover: true,
            existing_media_type: Some(existing_format.media_type().to_string()),
            had_cover_meta: !manifest.cover_meta_ids.is_empty(),
            had_cover_property: !property_ids.is_empty(),
        });
    }

    let output_format = output_format_for_package(manifest.version, source_format, None)?;
    let used_ids = manifest
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    let used_hrefs = manifest
        .items
        .iter()
        .map(|item| item.href.clone())
        .collect::<HashSet<_>>();
    let cover_item_id = unique_value(PACKAGE_COVER_ID_BASE, &used_ids);
    let cover_href = unique_cover_href(output_format.extension(), &used_hrefs);
    let cover_zip_path = epub_metadata::resolve_zip_relative_path(package_path, &cover_href)?;
    if archive_name_counts.contains_key(cover_zip_path.as_str()) {
        return Err(
            "The generated EPUB cover path conflicts with an existing archive entry.".to_string(),
        );
    }

    Ok(CoverPackagePlan {
        package_version: manifest.version,
        cover_item_id,
        cover_href,
        cover_zip_path,
        output_format,
        existing_cover: false,
        existing_media_type: None,
        had_cover_meta: false,
        had_cover_property: false,
    })
}

pub(super) fn child_element_name(parent_name: &[u8], local_name: &str) -> String {
    let parent_name = String::from_utf8_lossy(parent_name);
    parent_name
        .split_once(':')
        .map(|(prefix, _)| format!("{prefix}:{local_name}"))
        .unwrap_or_else(|| local_name.to_string())
}

pub(super) fn is_cover_meta(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> bool {
    let attributes = attributes_map(reader, event);
    local_attribute(&attributes, "name")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("cover"))
}

pub(super) fn rewritten_item_event(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<BytesStart<'static>, String> {
    let attributes = ordered_attributes(reader, event);
    let item_id = attributes
        .iter()
        .find_map(|(key, value)| {
            key.rsplit(':')
                .next()
                .is_some_and(|local| local == "id")
                .then_some(value.as_str())
        })
        .unwrap_or_default();
    let event_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
    let mut rewritten = BytesStart::new(event_name);
    let selected = item_id == plan.cover_item_id;
    let mark_cover = plan.package_version.is_epub_three() || plan.had_cover_property;
    let mut media_type_written = false;
    let mut properties_written = false;

    for (key, value) in &attributes {
        let local = key.rsplit(':').next().unwrap_or(key.as_str());
        if selected && local == "media-type" {
            rewritten.push_attribute((key.as_str(), output_format.media_type()));
            media_type_written = true;
            continue;
        }
        if local == "properties" {
            let mut properties = value
                .split_whitespace()
                .filter(|property| !property.eq_ignore_ascii_case("cover-image"))
                .map(str::to_string)
                .collect::<Vec<_>>();
            if selected && mark_cover {
                properties.push("cover-image".to_string());
            }
            if !properties.is_empty() {
                let properties = properties.join(" ");
                rewritten.push_attribute((key.as_str(), properties.as_str()));
            }
            properties_written = true;
            continue;
        }
        rewritten.push_attribute((key.as_str(), value.as_str()));
    }

    if selected && !media_type_written {
        rewritten.push_attribute(("media-type", output_format.media_type()));
    }
    if selected && mark_cover && !properties_written {
        rewritten.push_attribute(("properties", "cover-image"));
    }
    Ok(rewritten.into_owned())
}

pub(super) fn write_cover_meta(
    writer: &mut Writer<Vec<u8>>,
    element_name: &str,
    cover_item_id: &str,
) -> Result<(), String> {
    let mut meta = BytesStart::new(element_name);
    meta.push_attribute(("name", "cover"));
    meta.push_attribute(("content", cover_item_id));
    writer
        .write_event(Event::Empty(meta))
        .map_err(|error| error.to_string())
}

pub(super) fn write_new_cover_item(
    writer: &mut Writer<Vec<u8>>,
    element_name: &str,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<(), String> {
    let mut item = BytesStart::new(element_name);
    item.push_attribute(("id", plan.cover_item_id.as_str()));
    item.push_attribute(("href", plan.cover_href.as_str()));
    item.push_attribute(("media-type", output_format.media_type()));
    if plan.package_version.is_epub_three() {
        item.push_attribute(("properties", "cover-image"));
    }
    writer
        .write_event(Event::Empty(item))
        .map_err(|error| error.to_string())
}

pub(super) fn update_package_cover_xml(
    package_xml: &str,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<String, String> {
    let mut reader = Reader::from_str(package_xml);
    let mut writer = Writer::new(Vec::new());
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut metadata_found = false;
    let mut manifest_found = false;
    let mut selected_item_found = false;
    let mut skip_cover_meta_depth = 0_usize;
    let write_epub2_meta = plan.package_version.is_epub_two() || plan.had_cover_meta;
    let mut cover_meta_element_name = "meta".to_string();
    let mut cover_item_element_name = "item".to_string();

    loop {
        let event = reader.read_event().map_err(|error| error.to_string())?;
        if skip_cover_meta_depth > 0 {
            match event {
                Event::Start(_) => skip_cover_meta_depth += 1,
                Event::End(_) => skip_cover_meta_depth -= 1,
                Event::Eof => break,
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(event) => match event.local_name().as_ref() {
                b"metadata" => {
                    in_metadata = true;
                    metadata_found = true;
                    cover_meta_element_name = child_element_name(event.name().as_ref(), "meta");
                    writer
                        .write_event(Event::Start(event.into_owned()))
                        .map_err(|error| error.to_string())?;
                }
                b"manifest" => {
                    in_manifest = true;
                    manifest_found = true;
                    cover_item_element_name = child_element_name(event.name().as_ref(), "item");
                    writer
                        .write_event(Event::Start(event.into_owned()))
                        .map_err(|error| error.to_string())?;
                }
                b"meta" if in_metadata && is_cover_meta(&reader, &event) => {
                    skip_cover_meta_depth = 1;
                }
                b"item" if in_manifest => {
                    let attributes = attributes_map(&reader, &event);
                    let selected = local_attribute(&attributes, "id")
                        .is_some_and(|id| id == &plan.cover_item_id);
                    if selected {
                        selected_item_found = true;
                        let rewritten = rewritten_item_event(&reader, &event, plan, output_format)?;
                        writer
                            .write_event(Event::Start(rewritten))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                _ => writer
                    .write_event(Event::Start(event.into_owned()))
                    .map_err(|error| error.to_string())?,
            },
            Event::Empty(event) => match event.local_name().as_ref() {
                b"metadata" => {
                    metadata_found = true;
                    if write_epub2_meta {
                        let element_name =
                            String::from_utf8_lossy(event.name().as_ref()).into_owned();
                        let meta_element_name = child_element_name(event.name().as_ref(), "meta");
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                        write_cover_meta(&mut writer, &meta_element_name, &plan.cover_item_id)?;
                        writer
                            .write_event(Event::End(BytesEnd::new(element_name)))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                b"manifest" => {
                    manifest_found = true;
                    if !plan.existing_cover {
                        let element_name =
                            String::from_utf8_lossy(event.name().as_ref()).into_owned();
                        let item_element_name = child_element_name(event.name().as_ref(), "item");
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                        write_new_cover_item(&mut writer, &item_element_name, plan, output_format)?;
                        writer
                            .write_event(Event::End(BytesEnd::new(element_name)))
                            .map_err(|error| error.to_string())?;
                        selected_item_found = true;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                b"meta" if in_metadata && is_cover_meta(&reader, &event) => {}
                b"item" if in_manifest => {
                    let attributes = attributes_map(&reader, &event);
                    let selected = local_attribute(&attributes, "id")
                        .is_some_and(|id| id == &plan.cover_item_id);
                    if selected {
                        selected_item_found = true;
                        let rewritten = rewritten_item_event(&reader, &event, plan, output_format)?;
                        writer
                            .write_event(Event::Empty(rewritten))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                _ => writer
                    .write_event(Event::Empty(event.into_owned()))
                    .map_err(|error| error.to_string())?,
            },
            Event::End(event) if event.local_name().as_ref() == b"metadata" => {
                if write_epub2_meta {
                    write_cover_meta(&mut writer, &cover_meta_element_name, &plan.cover_item_id)?;
                }
                writer
                    .write_event(Event::End(event.into_owned()))
                    .map_err(|error| error.to_string())?;
                in_metadata = false;
            }
            Event::End(event) if event.local_name().as_ref() == b"manifest" => {
                if !plan.existing_cover {
                    write_new_cover_item(
                        &mut writer,
                        &cover_item_element_name,
                        plan,
                        output_format,
                    )?;
                    selected_item_found = true;
                }
                writer
                    .write_event(Event::End(event.into_owned()))
                    .map_err(|error| error.to_string())?;
                in_manifest = false;
            }
            Event::Eof => break,
            event => writer
                .write_event(event.into_owned())
                .map_err(|error| error.to_string())?,
        }
    }

    if !metadata_found {
        return Err("EPUB package metadata section was not found.".to_string());
    }
    if !manifest_found {
        return Err("EPUB package manifest section was not found.".to_string());
    }
    if !selected_item_found {
        return Err("EPUB cover manifest item could not be updated.".to_string());
    }
    String::from_utf8(writer.into_inner()).map_err(|error| error.to_string())
}
