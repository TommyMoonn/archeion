use std::collections::HashMap;

use quick_xml::{events::BytesStart, Reader};

const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";

pub(super) fn ordered_attributes(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Vec<(String, String)> {
    event
        .attributes()
        .filter_map(Result::ok)
        .filter_map(|attribute| {
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
                .ok()?
                .into_owned();
            Some((key, value))
        })
        .collect()
}

pub(super) fn attributes_map(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> HashMap<String, String> {
    ordered_attributes(reader, event).into_iter().collect()
}

pub(super) fn strict_attributes_map(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    resource_label: &str,
) -> Result<HashMap<String, String>, String> {
    event
        .attributes()
        .map(|attribute| {
            let attribute = attribute.map_err(|error| {
                format!(
                    "The EPUB {resource_label} contains a malformed attribute. The file was not modified. {error}"
                )
            })?;
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
                .map_err(|error| {
                    format!(
                        "The EPUB {resource_label} contains an invalid attribute value. The file was not modified. {error}"
                    )
                })?
                .into_owned();
            Ok((key, value))
        })
        .collect()
}

pub(super) fn local_attribute<'a>(
    attributes: &'a HashMap<String, String>,
    name: &str,
) -> Option<&'a String> {
    attributes.iter().find_map(|(key, value)| {
        key.rsplit(':')
            .next()
            .is_some_and(|local| local == name)
            .then_some(value)
    })
}

pub(super) fn local_attribute_values(
    attributes: &HashMap<String, String>,
    name: &str,
) -> Vec<String> {
    let mut values = attributes
        .iter()
        .filter(|(key, _)| key.rsplit(':').next().is_some_and(|local| local == name))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

pub(super) fn unique_local_attribute(
    attributes: &HashMap<String, String>,
    name: &str,
    resource_label: &str,
) -> Result<Option<String>, String> {
    match local_attribute_values(attributes, name).as_slice() {
        [] => Ok(None),
        [value] => Ok(Some(value.clone())),
        _ => Err(format!(
            "The EPUB {resource_label} contains conflicting {name} attributes. The file was not modified."
        )),
    }
}

pub(super) fn token_list_contains(value: &str, expected: &str) -> bool {
    value
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case(expected))
}

pub(super) fn apply_namespace_declarations(
    attributes: &HashMap<String, String>,
    bindings: &mut HashMap<String, String>,
) -> Result<(), String> {
    for (key, value) in attributes {
        let Some(prefix) = key.strip_prefix("xmlns:") else {
            continue;
        };
        let namespace = value.trim();
        if prefix.is_empty() || namespace.is_empty() {
            return Err(
                "The EPUB navigation document contains an invalid namespace declaration. The file was not modified."
                    .to_string(),
            );
        }
        bindings.insert(prefix.to_string(), namespace.to_string());
    }
    Ok(())
}

pub(super) fn epub_type_contains(
    attributes: &HashMap<String, String>,
    namespace_bindings: &HashMap<String, String>,
    expected: &str,
) -> Result<bool, String> {
    let mut values = Vec::new();
    for (key, value) in attributes {
        let Some((prefix, local_name)) = key.split_once(':') else {
            continue;
        };
        if local_name != "type" {
            continue;
        }
        match namespace_bindings.get(prefix).map(String::as_str) {
            Some(EPUB_OPS_NAMESPACE) => values.push(value.trim().to_string()),
            None if prefix != "xml" && token_list_contains(value, expected) => {
                return Err(
                    "The EPUB navigation document uses a namespaced type without declaring its namespace. The file was not modified."
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    values.sort();
    values.dedup();
    if values.len() > 1 {
        return Err(
            "The EPUB navigation document contains conflicting epub:type attributes. The file was not modified."
                .to_string(),
        );
    }
    Ok(values
        .first()
        .is_some_and(|value| token_list_contains(value, expected)))
}
