use std::collections::BTreeSet;

use serde_json::Value;

// Match String.trim() in the Reader's annotationsMetadata.ts.
pub(super) fn trim_annotation_text(text: &str) -> &str {
    text.trim_matches(|character: char| {
        character == '\u{feff}' || (character != '\u{0085}' && character.is_whitespace())
    })
}

fn nonempty_text(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(trim_annotation_text)
        .filter(|text| !text.is_empty())
}

fn digits(value: &[u8]) -> Option<u16> {
    value.iter().try_fold(0_u16, |number, digit| {
        digit
            .is_ascii_digit()
            .then(|| number * 10 + u16::from(*digit - b'0'))
    })
}

fn valid_timestamp(value: Option<&Value>) -> bool {
    let Some(text) = nonempty_text(value) else {
        return false;
    };
    let Some((date_time, zone)) = text.as_bytes().split_at_checked(19) else {
        return false;
    };
    let [y1, y2, y3, y4, b'-', mo1, mo2, b'-', d1, d2, b'T', h1, h2, b':', m1, m2, b':', s1, s2] =
        date_time
    else {
        return false;
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        digits(&[*y1, *y2, *y3, *y4]),
        digits(&[*mo1, *mo2]),
        digits(&[*d1, *d2]),
        digits(&[*h1, *h2]),
        digits(&[*m1, *m2]),
        digits(&[*s1, *s2]),
    ) else {
        return false;
    };
    // The Reader uses Date.UTC to count the days in each month.
    let calendar_year = if year < 100 { year + 1900 } else { year };
    let leap = calendar_year.is_multiple_of(4)
        && (!calendar_year.is_multiple_of(100) || calendar_year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    if day == 0 || day > days || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let zone = if let Some(fraction) = zone.strip_prefix(b".") {
        let count = fraction
            .iter()
            .take_while(|digit| digit.is_ascii_digit())
            .count();
        if count == 0 {
            return false;
        }
        &fraction[count..]
    } else {
        zone
    };
    match zone {
        [b'Z'] => true,
        [b'+' | b'-', a, b, b':', c, d] => {
            digits(&[*a, *b]).is_some_and(|hour| hour <= 23)
                && digits(&[*c, *d]).is_some_and(|minute| minute <= 59)
        }
        _ => false,
    }
}

fn valid_annotation_id(entry: &Value) -> Option<&str> {
    let data = entry.as_object()?;
    let id = nonempty_text(data.get("id"))?;
    if !valid_timestamp(data.get("createdAt"))
        || !valid_timestamp(data.get("updatedAt"))
        || data
            .get("anchorStatus")
            .is_some_and(|status| status.as_str() != Some("detached"))
    {
        return None;
    }
    let kind = data.get("type").and_then(Value::as_str)?;
    let optional_text = |keys: &[&str]| {
        keys.iter()
            .all(|key| data.get(*key).is_none_or(Value::is_string))
    };
    let absent = |keys: &[&str]| keys.iter().all(|key| !data.contains_key(*key));
    let valid = match kind {
        "bookmark" => {
            optional_text(&["cfiRange", "chapterHref", "label"])
                && absent(&[
                    "selectedText",
                    "contextBefore",
                    "contextAfter",
                    "color",
                    "note",
                ])
        }
        "highlight" => {
            optional_text(&["chapterHref", "contextBefore", "contextAfter", "note"])
                && absent(&["label"])
                && ["cfiRange", "selectedText", "color"]
                    .iter()
                    .all(|key| nonempty_text(data.get(*key)).is_some())
        }
        _ => false,
    };
    valid.then_some(id)
}

pub(super) fn validate_annotations_metadata(metadata: &Value) -> Result<(), String> {
    if metadata.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err("The archive annotation metadata version is unsupported.".to_string());
    }
    let invalid =
        || "The annotation import would produce invalid archive annotation metadata.".to_string();
    let books = metadata
        .get("books")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    for (book_id, book) in books {
        if trim_annotation_text(book_id).is_empty() {
            return Err(invalid());
        }
        let annotations = book
            .get("annotations")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        let mut ids = BTreeSet::new();
        if !annotations
            .iter()
            .all(|entry| valid_annotation_id(entry).is_some_and(|id| ids.insert(id)))
        {
            return Err(invalid());
        }
    }
    Ok(())
}
