use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::font_family::normalize_family;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ReaderBuiltinFontId {
    #[default]
    Serif,
    Sans,
    System,
    Literata,
    Atkinson,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReaderFontSelection {
    Builtin { id: ReaderBuiltinFontId },
    System { family: String },
}

impl Default for ReaderFontSelection {
    fn default() -> Self {
        Self::Builtin {
            id: ReaderBuiltinFontId::Serif,
        }
    }
}

impl<'de> Deserialize<'de> for ReaderFontSelection {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
        enum Structured {
            Builtin { id: ReaderBuiltinFontId },
            System { family: String },
        }
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Legacy(String),
            Current(Structured),
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::Legacy(id) => normalize_reader_font(Some(&Value::String(id))),
            Wire::Current(Structured::Builtin { id }) => Self::Builtin { id },
            Wire::Current(Structured::System { family }) => {
                normalize_family(Some(&Value::String(family)))
                    .map(|family| Self::System { family })
                    .unwrap_or_default()
            }
        })
    }
}

pub(super) fn normalize_reader_font(value: Option<&Value>) -> ReaderFontSelection {
    let Some(value) = value else {
        return ReaderFontSelection::default();
    };
    let builtin_id = if value.is_string() {
        Some(value)
    } else if value["kind"] == "builtin" {
        value.get("id")
    } else {
        None
    };
    if let Some(id) = builtin_id.and_then(|id| serde_json::from_value(id.clone()).ok()) {
        return ReaderFontSelection::Builtin { id };
    }
    if value["kind"] == "system" {
        if let Some(family) = normalize_family(value.get("family")) {
            return ReaderFontSelection::System { family };
        }
    }
    ReaderFontSelection::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_and_structured_selections_serialize_to_the_current_model() {
        for id in ["serif", "sans", "system", "literata", "atkinson"] {
            let legacy: ReaderFontSelection = serde_json::from_value(json!(id)).unwrap();
            let structured: ReaderFontSelection =
                serde_json::from_value(json!({"kind":"builtin", "id":id})).unwrap();
            assert_eq!(legacy, structured);
            assert_eq!(
                serde_json::to_value(legacy).unwrap(),
                json!({"kind":"builtin", "id":id})
            );
        }
        let unknown: ReaderFontSelection = serde_json::from_value(json!("obsolete-font")).unwrap();
        assert_eq!(unknown, ReaderFontSelection::default());
    }

    #[test]
    fn missing_families_are_preserved_but_invalid_labels_fall_back() {
        let value = json!({"kind":"system", "family":"  Missing 日本語, Book \"One\" \\ Serif  "});
        let selection = normalize_reader_font(Some(&value));
        assert_eq!(
            serde_json::to_value(&selection).unwrap(),
            json!({"kind":"system", "family":"Missing 日本語, Book \"One\" \\ Serif"})
        );
        assert_eq!(
            serde_json::from_value::<ReaderFontSelection>(serde_json::to_value(selection).unwrap())
                .unwrap(),
            normalize_reader_font(Some(&value))
        );
        for family in ["".to_string(), "bad\nfont".to_string(), "𐐀".repeat(257)] {
            assert_eq!(
                normalize_reader_font(Some(&json!({"kind":"system", "family":family}))),
                ReaderFontSelection::default()
            );
        }
    }

    #[test]
    fn malformed_structured_mutation_values_are_rejected() {
        for value in [
            json!({"kind":"builtin", "id":"unknown"}),
            json!({"kind":"system"}),
            json!({"kind":"system", "family":42}),
            json!({"kind":"future", "family":"Arial"}),
        ] {
            assert!(serde_json::from_value::<ReaderFontSelection>(value).is_err());
        }
    }
}
