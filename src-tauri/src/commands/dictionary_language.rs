pub(crate) fn canonicalize_language_tag(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 64 || value.contains('\0') {
        return None;
    }

    let mut subtags = value.split('-');
    let language = subtags.next()?;
    if !(2..=8).contains(&language.len())
        || !language.bytes().all(|byte| byte.is_ascii_alphabetic())
    {
        return None;
    }

    let mut canonical = language.to_ascii_lowercase();
    let mut script_seen = false;
    let mut region_seen = false;
    let mut variant_seen = false;
    for subtag in subtags {
        if subtag.is_empty()
            || subtag.len() > 8
            || !subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return None;
        }

        canonical.push('-');
        if !script_seen
            && !region_seen
            && !variant_seen
            && subtag.len() == 4
            && subtag.bytes().all(|byte| byte.is_ascii_alphabetic())
        {
            let mut characters = subtag.chars();
            canonical.extend(characters.next()?.to_uppercase());
            canonical.push_str(&characters.as_str().to_ascii_lowercase());
            script_seen = true;
        } else if !region_seen
            && !variant_seen
            && ((subtag.len() == 2 && subtag.bytes().all(|byte| byte.is_ascii_alphabetic()))
                || (subtag.len() == 3 && subtag.bytes().all(|byte| byte.is_ascii_digit())))
        {
            canonical.push_str(&subtag.to_ascii_uppercase());
            region_seen = true;
        } else if (subtag.len() == 4 && subtag.as_bytes().first().is_some_and(u8::is_ascii_digit))
            || (5..=8).contains(&subtag.len())
        {
            canonical.push_str(&subtag.to_ascii_lowercase());
            variant_seen = true;
        } else {
            return None;
        }
    }

    Some(canonical)
}

pub(crate) fn is_canonical_language_tag(value: &str) -> bool {
    canonicalize_language_tag(value).as_deref() == Some(value)
}

#[cfg(test)]
mod tests {
    use super::{canonicalize_language_tag, is_canonical_language_tag};

    #[test]
    fn canonicalizes_supported_bcp47_language_tags() {
        assert_eq!(
            canonicalize_language_tag(" EN-us ").as_deref(),
            Some("en-US")
        );
        assert_eq!(
            canonicalize_language_tag("zh-hant-tw").as_deref(),
            Some("zh-Hant-TW")
        );
        assert_eq!(canonicalize_language_tag("und").as_deref(), Some("und"));
        assert!(is_canonical_language_tag("fr"));
        assert!(!is_canonical_language_tag("FR"));
    }

    #[test]
    fn rejects_non_language_or_extension_like_values() {
        for value in [
            "",
            "e",
            "en_US",
            "12",
            "en--US",
            "en-x-private",
            "en-US-Latn",
            "de-1901-DE",
        ] {
            assert_eq!(canonicalize_language_tag(value), None, "{value}");
        }
    }
}
