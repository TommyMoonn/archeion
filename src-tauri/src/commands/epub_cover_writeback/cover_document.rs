use std::collections::{HashMap, HashSet};

use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};

use super::{
    super::epub_metadata,
    package::{
        is_non_local_reference, manifest_item_has_property, require_unique_archive_entry,
        resolve_local_document_path, CoverPageRelationship, ManifestItem, PackageManifest,
    },
    types::CoverImageFormat,
    xml::{
        apply_namespace_declarations, epub_type_contains, strict_attributes_map,
        token_list_contains, unique_local_attribute,
    },
};

const MAX_COVER_PAGE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NAVIGATION_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COVER_STYLESHEET_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
struct CoverPageDependencies {
    image_href: String,
    stylesheet_hrefs: Vec<String>,
}

fn manifest_item_for_zip_path<'a>(
    items: &'a [ManifestItem],
    package_path: &str,
    target_zip_path: &str,
) -> Result<&'a ManifestItem, String> {
    let matches = items
        .iter()
        .filter(|item| !is_non_local_reference(&item.href))
        .filter(|item| {
            let decoded_href = epub_metadata::decode_archive_href(&item.href);
            epub_metadata::resolve_zip_relative_path(package_path, &decoded_href)
                .is_ok_and(|path| path == target_zip_path)
        })
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [item] => Ok(item),
        [] => Err(format!(
            "The EPUB cover resource \"{target_zip_path}\" is not tied to a manifest item. The file was not modified."
        )),
        _ => Err(format!(
            "The EPUB cover resource \"{target_zip_path}\" is tied to multiple manifest items. The file was not modified."
        )),
    }
}

fn contains_css_function(value: &str, function_name: &[u8]) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0_usize;
    while index + function_name.len() <= bytes.len() {
        if !bytes[index..index + function_name.len()].eq_ignore_ascii_case(function_name) {
            index += 1;
            continue;
        }
        if index > 0
            && (bytes[index - 1].is_ascii_alphanumeric() || matches!(bytes[index - 1], b'-' | b'_'))
        {
            index += 1;
            continue;
        }
        let mut cursor = index + function_name.len();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor] == b'(' {
            return true;
        }
        index += 1;
    }
    false
}

fn has_local_attribute(attributes: &HashMap<String, String>, name: &str) -> bool {
    attributes
        .keys()
        .any(|key| key.rsplit(':').next() == Some(name))
}

fn reject_unsafe_document_attributes(
    attributes: &HashMap<String, String>,
    document_label: &str,
    reject_event_handlers: bool,
) -> Result<(), String> {
    if attributes
        .keys()
        .any(|key| key.eq_ignore_ascii_case("xml:base"))
    {
        return Err(format!(
            "The EPUB {document_label} uses xml:base, so document-relative resources cannot be resolved safely. The file was not modified."
        ));
    }

    if reject_event_handlers
        && attributes.keys().any(|key| {
            key.rsplit(':').next().is_some_and(|local_name| {
                local_name
                    .as_bytes()
                    .get(..2)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"on"))
            })
        })
    {
        return Err(format!(
            "The EPUB {document_label} uses an event-handler attribute, so its displayed content cannot be resolved safely. The file was not modified."
        ));
    }

    Ok(())
}

fn inspect_cover_page_element(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    image_hrefs: &mut Vec<String>,
    stylesheet_hrefs: &mut Vec<String>,
) -> Result<bool, String> {
    let attributes = strict_attributes_map(reader, event, "cover page")?;
    reject_unsafe_document_attributes(&attributes, "cover page", true)?;
    if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
        return Err(
            "The EPUB cover page contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if has_local_attribute(&attributes, "srcset") {
        return Err(
            "The EPUB cover page uses srcset, so its displayed image cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if let Some(style) = unique_local_attribute(&attributes, "style", "cover page element")? {
        validate_cover_stylesheet(style.as_bytes())?;
    }

    match event.local_name().as_ref() {
        b"img" => {
            let href = unique_local_attribute(&attributes, "src", "cover page image")?
                .ok_or_else(|| {
                    "The EPUB cover page contains an image without a source. The file was not modified."
                        .to_string()
                })?;
            image_hrefs.push(href);
            Ok(false)
        }
        b"image" => {
            let href = unique_local_attribute(&attributes, "href", "cover page SVG image")?
                .ok_or_else(|| {
                    "The EPUB cover page contains an SVG image without an href. The file was not modified."
                        .to_string()
                })?;
            image_hrefs.push(href);
            Ok(false)
        }
        b"link" => {
            if unique_local_attribute(&attributes, "rel", "cover page link")?
                .as_deref()
                .is_some_and(|value| token_list_contains(value, "stylesheet"))
            {
                let href = unique_local_attribute(&attributes, "href", "cover page stylesheet")?
                    .ok_or_else(|| {
                        "The EPUB cover page contains a stylesheet link without an href. The file was not modified."
                            .to_string()
                    })?;
                stylesheet_hrefs.push(href);
            }
            Ok(false)
        }
        b"style" => Ok(true),
        b"picture" | b"source" => Err(
            "The EPUB cover page uses alternative image sources that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        b"script" => Err(
            "The EPUB cover page uses scripting that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        b"iframe" | b"object" | b"embed" => Err(
            "The EPUB cover page uses embedded content that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        _ => Ok(false),
    }
}

fn cover_page_dependencies(page_xml: &[u8]) -> Result<CoverPageDependencies, String> {
    let mut reader = Reader::from_reader(page_xml);
    let mut image_hrefs = Vec::new();
    let mut stylesheet_hrefs = Vec::new();
    let mut inline_style = None::<Vec<u8>>;

    loop {
        match reader.read_event().map_err(|error| {
            format!("The EPUB cover page is malformed and could not be analyzed safely. {error}")
        })? {
            Event::Start(event) => {
                if inspect_cover_page_element(
                    &reader,
                    &event,
                    &mut image_hrefs,
                    &mut stylesheet_hrefs,
                )? && inline_style.replace(Vec::new()).is_some()
                {
                    return Err(
                        "The EPUB cover page contains nested style elements and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
            }
            Event::Empty(event) => {
                if inspect_cover_page_element(
                    &reader,
                    &event,
                    &mut image_hrefs,
                    &mut stylesheet_hrefs,
                )? {
                    validate_cover_stylesheet(&[])?;
                }
            }
            Event::Text(event) => {
                if let Some(style) = inline_style.as_mut() {
                    style.extend_from_slice(event.as_ref());
                }
            }
            Event::CData(event) => {
                if let Some(style) = inline_style.as_mut() {
                    style.extend_from_slice(event.as_ref());
                }
            }
            Event::End(event) if event.local_name().as_ref() == b"style" => {
                let style = inline_style.take().ok_or_else(|| {
                    "The EPUB cover page contains an unmatched style element. The file was not modified."
                        .to_string()
                })?;
                validate_cover_stylesheet(&style)?;
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if inline_style.is_some() {
        return Err(
            "The EPUB cover page contains an unterminated style element. The file was not modified."
                .to_string(),
        );
    }
    if image_hrefs.len() != 1 {
        return Err(if image_hrefs.is_empty() {
            "The EPUB cover page does not contain one directly referenced image. The file was not modified."
                .to_string()
        } else {
            "The EPUB cover page contains multiple candidate images. The file was not modified."
                .to_string()
        });
    }

    let image_href = image_hrefs
        .pop()
        .expect("one cover page image was validated");
    if is_non_local_reference(&image_href) {
        return Err(
            "The EPUB cover page image uses an external, embedded, or unsafe reference. The file was not modified."
                .to_string(),
        );
    }

    stylesheet_hrefs.sort();
    stylesheet_hrefs.dedup();
    Ok(CoverPageDependencies {
        image_href,
        stylesheet_hrefs,
    })
}

fn validated_css_text(stylesheet_bytes: &[u8]) -> Result<String, String> {
    let stylesheet = std::str::from_utf8(stylesheet_bytes).map_err(|error| {
        format!(
            "The EPUB cover stylesheet is not valid UTF-8 and cannot be analyzed safely. The file was not modified. {error}"
        )
    })?;
    let mut output = String::with_capacity(stylesheet.len());
    let mut characters = stylesheet.chars().peekable();
    let mut quote = None;
    let mut escaped = false;
    let mut brace_depth = 0_i32;
    let mut parenthesis_depth = 0_i32;

    while characters.peek().is_some() {
        let character = characters
            .next()
            .expect("peeked stylesheet character should remain available");
        if let Some(quote_character) = quote {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote_character {
                quote = None;
            }
            continue;
        }

        if character == '/' && characters.peek() == Some(&'*') {
            let _ = characters.next();
            let mut closed = false;
            while characters.peek().is_some() {
                let comment_character = characters
                    .next()
                    .expect("peeked comment character should remain available");
                if comment_character == '*' && characters.peek() == Some(&'/') {
                    let _ = characters.next();
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err(
                    "The EPUB cover stylesheet contains an unterminated comment. The file was not modified."
                        .to_string(),
                );
            }
            output.push(' ');
            continue;
        }

        match character {
            '\'' | '"' => {
                quote = Some(character);
                output.push(character);
            }
            '{' => {
                brace_depth += 1;
                output.push(character);
            }
            '}' => {
                brace_depth -= 1;
                if brace_depth < 0 {
                    return Err(
                        "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
                output.push(character);
            }
            '(' => {
                parenthesis_depth += 1;
                output.push(character);
            }
            ')' => {
                parenthesis_depth -= 1;
                if parenthesis_depth < 0 {
                    return Err(
                        "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
                output.push(character);
            }
            '\\' => {
                return Err(
                    "The EPUB cover stylesheet uses escaped syntax that cannot be analyzed safely. The file was not modified."
                        .to_string(),
                );
            }
            _ => output.push(character),
        }
    }

    if quote.is_some() || brace_depth != 0 || parenthesis_depth != 0 {
        return Err(
            "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                .to_string(),
        );
    }
    Ok(output)
}

fn css_code_without_strings(stylesheet: &str) -> String {
    let mut output = String::with_capacity(stylesheet.len());
    let mut quote = None;
    let mut escaped = false;

    for character in stylesheet.chars() {
        if let Some(quote_character) = quote {
            output.push(' ');
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote_character {
                quote = None;
            }
            continue;
        }

        match character {
            '\'' | '"' => {
                quote = Some(character);
                output.push(' ');
            }
            _ => output.push(character),
        }
    }
    output
}

fn validate_cover_stylesheet(stylesheet_bytes: &[u8]) -> Result<(), String> {
    let stylesheet = validated_css_text(stylesheet_bytes)?;
    let code = css_code_without_strings(&stylesheet).to_ascii_lowercase();

    if code.contains("@import") {
        return Err(
            "The EPUB cover stylesheet imports another stylesheet, so its dependencies cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }

    for function_name in [
        &b"url"[..],
        &b"image-set"[..],
        &b"cross-fade"[..],
        &b"element"[..],
        &b"image"[..],
    ] {
        if contains_css_function(&code, function_name) {
            return Err(
                "The EPUB cover stylesheet uses an image resource dependency that Archeion cannot resolve safely. The file was not modified."
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn validate_cover_page_stylesheets<R>(
    package_path: &str,
    manifest: &PackageManifest,
    cover_page_zip_path: &str,
    stylesheet_hrefs: &[String],
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<(), String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let mut resolved_stylesheets = HashSet::new();
    for href in stylesheet_hrefs {
        let stylesheet_zip_path =
            resolve_local_document_path(cover_page_zip_path, href, "cover page stylesheet")?;
        if !resolved_stylesheets.insert(stylesheet_zip_path.clone()) {
            continue;
        }
        require_unique_archive_entry(
            archive_name_counts,
            &stylesheet_zip_path,
            "cover stylesheet resource",
        )?;
        let stylesheet_item =
            manifest_item_for_zip_path(&manifest.items, package_path, &stylesheet_zip_path)?;
        if !stylesheet_item
            .media_type
            .trim()
            .eq_ignore_ascii_case("text/css")
        {
            return Err(
                "The EPUB cover page stylesheet is not declared as text/css. The file was not modified."
                    .to_string(),
            );
        }
        let stylesheet_bytes =
            read_archive_entry(&stylesheet_zip_path, MAX_COVER_STYLESHEET_BYTES)?;
        validate_cover_stylesheet(&stylesheet_bytes)?;
    }
    Ok(())
}

fn resolve_cover_page_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    cover_page_zip_path: &str,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<CoverPageRelationship, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let cover_page_item =
        manifest_item_for_zip_path(&manifest.items, package_path, cover_page_zip_path)?;
    if !cover_page_item
        .media_type
        .trim()
        .eq_ignore_ascii_case("application/xhtml+xml")
    {
        return Err(
            "The EPUB cover-page relationship does not reference a supported XHTML document. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(cover_page_item, "scripted") {
        return Err(
            "The EPUB cover page is marked as scripted and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(cover_page_item, "remote-resources") {
        return Err(
            "The EPUB cover page is marked with the remote-resources property and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    require_unique_archive_entry(
        archive_name_counts,
        cover_page_zip_path,
        "cover page resource",
    )?;

    let cover_page_bytes = read_archive_entry(cover_page_zip_path, MAX_COVER_PAGE_BYTES)?;
    let dependencies = cover_page_dependencies(&cover_page_bytes)?;
    validate_cover_page_stylesheets(
        package_path,
        manifest,
        cover_page_zip_path,
        &dependencies.stylesheet_hrefs,
        archive_name_counts,
        read_archive_entry,
    )?;

    let image_zip_path = resolve_local_document_path(
        cover_page_zip_path,
        &dependencies.image_href,
        "cover page image",
    )?;
    require_unique_archive_entry(
        archive_name_counts,
        &image_zip_path,
        "cover page image resource",
    )?;
    let image_item = manifest_item_for_zip_path(&manifest.items, package_path, &image_zip_path)?;
    CoverImageFormat::from_media_type(&image_item.media_type).ok_or_else(|| {
        format!(
            "The EPUB cover page image uses unsupported media type \"{}\". The file was not modified.",
            if image_item.media_type.is_empty() {
                "missing"
            } else {
                image_item.media_type.as_str()
            }
        )
    })?;

    Ok(CoverPageRelationship {
        page_item_id: cover_page_item.id.clone(),
        image_item_id: image_item.id.clone(),
    })
}

fn resolve_guide_cover_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<Option<CoverPageRelationship>, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let mut guide_hrefs = manifest
        .guide_cover_hrefs
        .iter()
        .map(|href| href.trim().to_string())
        .collect::<Vec<_>>();
    guide_hrefs.sort();
    guide_hrefs.dedup();
    if guide_hrefs.is_empty() {
        return Ok(None);
    }
    if guide_hrefs.len() != 1 {
        return Err(
            "The EPUB declares multiple cover guide references. The file was not modified."
                .to_string(),
        );
    }

    let cover_page_zip_path =
        resolve_local_document_path(package_path, &guide_hrefs[0], "cover guide")?;
    resolve_cover_page_relationship(
        package_path,
        manifest,
        &cover_page_zip_path,
        archive_name_counts,
        read_archive_entry,
    )
    .map(Some)
}

fn navigation_cover_page_href(navigation_xml: &[u8]) -> Result<Option<String>, String> {
    let mut reader = Reader::from_reader(navigation_xml);
    let mut namespace_stack = Vec::<HashMap<String, String>>::new();
    let mut landmarks_depth = None;
    let mut landmarks_count = 0_usize;
    let mut cover_hrefs = Vec::new();

    loop {
        match reader.read_event().map_err(|error| {
            format!(
                "The EPUB navigation document is malformed and could not be analyzed safely. The file was not modified. {error}"
            )
        })? {
            Event::Start(event) => {
                let attributes = strict_attributes_map(&reader, &event, "navigation document")?;
                reject_unsafe_document_attributes(&attributes, "navigation document", false)?;
                if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
                    return Err(
                        "The EPUB navigation document contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                            .to_string(),
                    );
                }
                let mut namespace_bindings = namespace_stack.last().cloned().unwrap_or_default();
                apply_namespace_declarations(&attributes, &mut namespace_bindings)?;
                namespace_stack.push(namespace_bindings);
                let depth = namespace_stack.len();
                let namespace_bindings = namespace_stack
                    .last()
                    .expect("the current navigation element namespace scope should exist");

                if event.local_name().as_ref() == b"nav"
                    && epub_type_contains(&attributes, namespace_bindings, "landmarks")?
                {
                    landmarks_count += 1;
                    if landmarks_count > 1 {
                        return Err(
                            "The EPUB navigation document contains multiple landmarks navigation elements. The file was not modified."
                                .to_string(),
                        );
                    }
                    landmarks_depth = Some(depth);
                } else if event.local_name().as_ref() == b"a"
                    && landmarks_depth.is_some_and(|landmarks| depth > landmarks)
                    && epub_type_contains(&attributes, namespace_bindings, "cover")?
                {
                    let href =
                        unique_local_attribute(&attributes, "href", "cover landmark")?.ok_or_else(
                            || {
                                "The EPUB cover landmark is missing its href. The file was not modified."
                                    .to_string()
                            },
                        )?;
                    cover_hrefs.push(href);
                }
            }
            Event::Empty(event) => {
                let attributes = strict_attributes_map(&reader, &event, "navigation document")?;
                reject_unsafe_document_attributes(&attributes, "navigation document", false)?;
                if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
                    return Err(
                        "The EPUB navigation document contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                            .to_string(),
                    );
                }
                let mut namespace_bindings = namespace_stack.last().cloned().unwrap_or_default();
                apply_namespace_declarations(&attributes, &mut namespace_bindings)?;

                if event.local_name().as_ref() == b"nav"
                    && epub_type_contains(&attributes, &namespace_bindings, "landmarks")?
                {
                    landmarks_count += 1;
                    if landmarks_count > 1 {
                        return Err(
                            "The EPUB navigation document contains multiple landmarks navigation elements. The file was not modified."
                                .to_string(),
                        );
                    }
                } else if event.local_name().as_ref() == b"a"
                    && landmarks_depth.is_some()
                    && epub_type_contains(&attributes, &namespace_bindings, "cover")?
                {
                    let href =
                        unique_local_attribute(&attributes, "href", "cover landmark")?.ok_or_else(
                            || {
                                "The EPUB cover landmark is missing its href. The file was not modified."
                                    .to_string()
                            },
                        )?;
                    cover_hrefs.push(href);
                }
            }
            Event::End(event) => {
                let depth = namespace_stack.len();
                if event.local_name().as_ref() == b"nav" && landmarks_depth == Some(depth) {
                    landmarks_depth = None;
                }
                if namespace_stack.pop().is_none() {
                    return Err(
                        "The EPUB navigation document contains an unmatched closing element. The file was not modified."
                            .to_string(),
                    );
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !namespace_stack.is_empty() {
        return Err(
            "The EPUB navigation document contains an unterminated element. The file was not modified."
                .to_string(),
        );
    }
    if landmarks_count == 0 || cover_hrefs.is_empty() {
        return Ok(None);
    }
    if cover_hrefs.len() != 1 {
        return Err(
            "The EPUB navigation document contains multiple cover landmarks. The file was not modified."
                .to_string(),
        );
    }
    Ok(cover_hrefs.pop())
}

fn resolve_landmarks_cover_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<Option<CoverPageRelationship>, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    if !manifest.version.is_epub_three() {
        return Ok(None);
    }

    let navigation_items = manifest
        .items
        .iter()
        .filter(|item| manifest_item_has_property(item, "nav"))
        .collect::<Vec<_>>();
    let navigation_item = match navigation_items.as_slice() {
        [] => return Ok(None),
        [item] => *item,
        _ => {
            return Err(
                "The EPUB package declares multiple navigation documents, so cover landmarks cannot be resolved safely. The file was not modified."
                    .to_string(),
            )
        }
    };
    if !navigation_item
        .media_type
        .trim()
        .eq_ignore_ascii_case("application/xhtml+xml")
    {
        return Err(
            "The EPUB navigation document is not declared as application/xhtml+xml. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(navigation_item, "scripted") {
        return Err(
            "The EPUB navigation document is marked as scripted and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }

    let navigation_zip_path =
        resolve_local_document_path(package_path, &navigation_item.href, "navigation document")?;
    let manifest_navigation_item =
        manifest_item_for_zip_path(&manifest.items, package_path, &navigation_zip_path)?;
    if manifest_navigation_item.id != navigation_item.id {
        return Err(
            "The EPUB navigation document identity is ambiguous. The file was not modified."
                .to_string(),
        );
    }
    require_unique_archive_entry(
        archive_name_counts,
        &navigation_zip_path,
        "navigation document resource",
    )?;
    let navigation_bytes = read_archive_entry(&navigation_zip_path, MAX_NAVIGATION_DOCUMENT_BYTES)?;
    let cover_href = match navigation_cover_page_href(&navigation_bytes)? {
        Some(href) => href,
        None => return Ok(None),
    };
    let cover_page_zip_path =
        resolve_local_document_path(&navigation_zip_path, &cover_href, "cover landmark")?;
    resolve_cover_page_relationship(
        package_path,
        manifest,
        &cover_page_zip_path,
        archive_name_counts,
        read_archive_entry,
    )
    .map(Some)
}

fn reconcile_cover_page_relationships(
    guide: Option<CoverPageRelationship>,
    landmarks: Option<CoverPageRelationship>,
) -> Result<Option<CoverPageRelationship>, String> {
    match (guide, landmarks) {
        (Some(guide), Some(landmarks)) => {
            if guide.page_item_id != landmarks.page_item_id {
                return Err(
                    "The EPUB guide and landmarks navigation identify different cover pages. The file was not modified."
                        .to_string(),
                );
            }
            if guide.image_item_id != landmarks.image_item_id {
                return Err(
                    "The EPUB guide and landmarks cover pages identify different image resources. The file was not modified."
                        .to_string(),
                );
            }
            Ok(Some(guide))
        }
        (Some(guide), None) => Ok(Some(guide)),
        (None, Some(landmarks)) => Ok(Some(landmarks)),
        (None, None) => Ok(None),
    }
}

pub(super) fn resolve_cover_page_relationships<R>(
    package_path: &str,
    manifest: &PackageManifest,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<Option<CoverPageRelationship>, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let guide_relationship = resolve_guide_cover_relationship(
        package_path,
        manifest,
        archive_name_counts,
        read_archive_entry,
    )?;
    let landmarks_relationship = resolve_landmarks_cover_relationship(
        package_path,
        manifest,
        archive_name_counts,
        read_archive_entry,
    )?;
    reconcile_cover_page_relationships(guide_relationship, landmarks_relationship)
}
