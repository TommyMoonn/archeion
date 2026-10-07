use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::font_family::normalize_family;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InterfaceFontSelection {
    #[default]
    Default,
    System {
        family: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DisplayFontSelection {
    Interface,
    #[default]
    Default,
    System {
        family: String,
    },
}

pub(super) fn normalize_interface_font(value: Option<&Value>) -> InterfaceFontSelection {
    if let Some(value) = value.filter(|value| value["kind"] == "system") {
        if let Some(family) = normalize_family(value.get("family")) {
            return InterfaceFontSelection::System { family };
        }
    }
    InterfaceFontSelection::Default
}

pub(super) fn normalize_display_font(value: Option<&Value>) -> DisplayFontSelection {
    if let Some(value) = value {
        if value["kind"] == "interface" {
            return DisplayFontSelection::Interface;
        }
        if let InterfaceFontSelection::System { family } = normalize_interface_font(Some(value)) {
            return DisplayFontSelection::System { family };
        }
    }
    DisplayFontSelection::Default
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn family_bound_is_unicode_code_points_and_rejects_controls() {
        let family = "𐐀".repeat(256);
        assert_eq!(normalize_family(Some(&json!(family))), Some(family));
        assert_eq!(normalize_family(Some(&json!("𐐀".repeat(257)))), None);
        for invalid in [
            "",
            "   ",
            "Arial\n",
            "\tArial",
            "A\u{7f}rial",
            "A\u{85}rial",
        ] {
            assert_eq!(normalize_family(Some(&json!(invalid))), None);
        }
    }
}
