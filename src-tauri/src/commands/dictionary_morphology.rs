const MIN_PLAIN_STEM_LEN: usize = 4;

/// Produces at most one conservative regular lemma candidate. Exact headwords
/// and package-owned aliases are queried before this helper, so ambiguous or
/// irregular spelling classes deliberately return no runtime candidate.
pub(crate) fn english_lemma_candidates(term: &str) -> Vec<String> {
    if term.is_empty() || !term.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return Vec::new();
    }

    regular_lemma_candidate(term).into_iter().collect()
}

fn regular_lemma_candidate(term: &str) -> Option<String> {
    if let Some(stem) = term.strip_suffix("iest") {
        return consonant_y_candidate(stem);
    }
    if let Some(stem) = term.strip_suffix("ier") {
        return consonant_y_candidate(stem);
    }
    if let Some(stem) = term.strip_suffix("est") {
        if let Some(lemma) = reverse_safe_doubling(stem) {
            return Some(lemma);
        }
        if stem.len() >= 3 && (stem.ends_with('c') || stem.ends_with('g') || stem.ends_with('v')) {
            return Some(format!("{stem}e"));
        }
        return (stem.len() >= MIN_PLAIN_STEM_LEN).then(|| stem.to_string());
    }
    if let Some(stem) = term.strip_suffix("er") {
        return reverse_safe_doubling(stem);
    }

    if let Some(stem) = term.strip_suffix("ied") {
        return consonant_y_candidate(stem);
    }
    if let Some(stem) = term.strip_suffix("ed") {
        if let Some(lemma) = reverse_safe_doubling(stem) {
            return Some(lemma);
        }
        if has_short_cvc_shape(stem) {
            return Some(format!("{stem}e"));
        }
        if has_doubled_final_consonant(stem) {
            return None;
        }
        return (stem.len() >= MIN_PLAIN_STEM_LEN).then(|| stem.to_string());
    }

    if let Some(stem) = term.strip_suffix("ing") {
        if let Some(lemma) = reverse_safe_doubling(stem) {
            return Some(lemma);
        }
        return has_short_cvc_shape(stem).then(|| format!("{stem}e"));
    }

    if let Some(stem) = term.strip_suffix("ies") {
        return consonant_y_candidate(stem);
    }
    if term.ends_with("ves") {
        return None;
    }
    if let Some(stem) = term.strip_suffix("es") {
        return takes_unambiguous_es(stem).then(|| stem.to_string());
    }
    if let Some(stem) = term.strip_suffix('s') {
        return (stem.len() >= MIN_PLAIN_STEM_LEN
            && !term.ends_with("ss")
            && !term.ends_with("us")
            && !term.ends_with("is"))
        .then(|| stem.to_string());
    }

    None
}

fn consonant_y_candidate(stem: &str) -> Option<String> {
    (stem.len() >= MIN_PLAIN_STEM_LEN).then(|| format!("{stem}y"))
}

fn reverse_safe_doubling(stem: &str) -> Option<String> {
    let mut chars = stem.char_indices().rev();
    let (_, last) = chars.next()?;
    let (previous_index, previous) = chars.next()?;
    // Other doubled endings have verified retained or lexical collisions.
    // Keep those forms package-owned instead of broadening this bounded rule.
    (last == previous && matches!(last, 'g' | 'n' | 'p') && previous_index >= 2)
        .then(|| stem[..previous_index + last.len_utf8()].to_string())
}

fn has_doubled_final_consonant(stem: &str) -> bool {
    let mut chars = stem.chars().rev();
    matches!((chars.next(), chars.next()), (Some(last), Some(previous)) if last == previous && last.is_ascii_alphabetic() && !is_vowel(last))
}

fn has_short_cvc_shape(stem: &str) -> bool {
    let chars = stem.as_bytes();
    chars.len() == 3
        && !is_vowel(char::from(chars[0]))
        && is_vowel(char::from(chars[1]))
        && !is_vowel(char::from(chars[2]))
        && !matches!(chars[2], b'w' | b'x' | b'y')
}

fn takes_unambiguous_es(stem: &str) -> bool {
    stem.len() >= 3
        && (stem.ends_with("ss")
            || stem.ends_with('x')
            || (stem.ends_with('z') && !stem.ends_with("zz"))
            || stem.ends_with("ch")
            || stem.ends_with("sh"))
}

fn is_vowel(character: char) -> bool {
    matches!(character, 'a' | 'e' | 'i' | 'o' | 'u')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_complete_bounded_regular_candidate_lists() {
        for (surface, expected) in [
            ("books", &["book"][..]),
            ("walked", &["walk"]),
            ("studied", &["study"]),
            ("stories", &["story"]),
            ("making", &["make"]),
            ("running", &["run"]),
            ("happier", &["happy"]),
            ("happiest", &["happy"]),
            ("bigger", &["big"]),
            ("biggest", &["big"]),
            ("largest", &["large"]),
            ("fastest", &["fast"]),
            ("hoped", &["hope"]),
            ("classes", &["class"]),
            ("boxes", &["box"]),
            ("watches", &["watch"]),
        ] {
            assert_eq!(english_lemma_candidates(surface), expected, "{surface}");
        }
    }

    #[test]
    fn suffix_looking_lexical_words_never_create_runtime_candidates() {
        for surface in [
            "thing", "being", "best", "her", "priest", "forest", "flower", "news", "movies",
            "untied", "better", "user", "gassed", "wolves", "knives", "leaves",
        ] {
            assert_eq!(
                english_lemma_candidates(surface),
                Vec::<String>::new(),
                "{surface}"
            );
        }
    }

    #[test]
    fn phrases_and_unrelated_words_have_no_candidates() {
        for surface in ["ice creams", "quartz", "press"] {
            assert_eq!(
                english_lemma_candidates(surface),
                Vec::<String>::new(),
                "{surface}"
            );
        }
    }
}
