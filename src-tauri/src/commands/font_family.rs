use serde_json::Value;

const MAX_FAMILY_LENGTH: usize = 256;

pub(super) fn normalize_family(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?;
    if value.chars().any(char::is_control) {
        return None;
    }
    // Match JavaScript String.trim, including its BOM whitespace behavior.
    let family = value.trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{feff}');
    if family.is_empty() || family.chars().count() > MAX_FAMILY_LENGTH {
        return None;
    }
    Some(family.to_string())
}
