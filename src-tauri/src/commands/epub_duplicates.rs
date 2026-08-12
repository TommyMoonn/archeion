use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::{
    epub_analysis_cache::CachedEpubDigest,
    epub_digest::{self, EpubDigestArchiveSession},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EpubDuplicateCandidate {
    pub(crate) relative_path: String,
    pub(crate) size_bytes: u64,
    pub(crate) identifier: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EpubDuplicateKind {
    Exact,
    Probable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDuplicateGroup {
    pub(crate) kind: EpubDuplicateKind,
    pub(crate) identity: String,
    pub(crate) members: Vec<String>,
}

pub(crate) fn classify(
    session: &EpubDigestArchiveSession,
    candidates: &[EpubDuplicateCandidate],
) -> Result<Vec<EpubDuplicateGroup>, String> {
    classify_with(candidates, |relative_path| {
        epub_digest::digest(session, relative_path)
    })
}

fn classify_with<D>(
    candidates: &[EpubDuplicateCandidate],
    mut digest: D,
) -> Result<Vec<EpubDuplicateGroup>, String>
where
    D: FnMut(&str) -> Result<CachedEpubDigest, String>,
{
    let mut candidates_by_path = BTreeMap::new();
    for candidate in candidates {
        if candidates_by_path
            .insert(candidate.relative_path.as_str(), candidate)
            .is_some()
        {
            return Err(format!(
                "Duplicate analysis received the same EPUB path more than once: {}",
                candidate.relative_path
            ));
        }
    }

    let mut size_groups: BTreeMap<u64, Vec<&EpubDuplicateCandidate>> = BTreeMap::new();
    for candidate in candidates_by_path.values() {
        size_groups
            .entry(candidate.size_bytes)
            .or_default()
            .push(candidate);
    }

    let mut exact_groups_by_digest: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for size_group in size_groups.values().filter(|group| group.len() >= 2) {
        for candidate in size_group {
            let digest = digest(&candidate.relative_path)?;
            exact_groups_by_digest
                .entry(digest.sha256)
                .or_default()
                .push(candidate.relative_path.clone());
        }
    }

    let mut exact_members = BTreeSet::new();
    let mut groups = Vec::new();
    for (identity, mut members) in exact_groups_by_digest {
        if members.len() < 2 {
            continue;
        }
        members.sort();
        exact_members.extend(members.iter().cloned());
        groups.push(EpubDuplicateGroup {
            kind: EpubDuplicateKind::Exact,
            identity,
            members,
        });
    }

    let mut probable_groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for candidate in candidates_by_path.values() {
        if exact_members.contains(&candidate.relative_path) {
            continue;
        }
        let Some(identifier) = candidate
            .identifier
            .as_deref()
            .map(str::trim)
            .filter(|identifier| !identifier.is_empty())
        else {
            continue;
        };
        probable_groups
            .entry(identifier.to_string())
            .or_default()
            .push(candidate.relative_path.clone());
    }
    for (identity, mut members) in probable_groups {
        if members.len() < 2 {
            continue;
        }
        members.sort();
        groups.push(EpubDuplicateGroup {
            kind: EpubDuplicateKind::Probable,
            identity,
            members,
        });
    }

    groups.sort_by(|left, right| {
        duplicate_kind_rank(left.kind)
            .cmp(&duplicate_kind_rank(right.kind))
            .then_with(|| left.identity.cmp(&right.identity))
            .then_with(|| left.members.cmp(&right.members))
    });
    Ok(groups)
}

fn duplicate_kind_rank(kind: EpubDuplicateKind) -> u8 {
    match kind {
        EpubDuplicateKind::Exact => 0,
        EpubDuplicateKind::Probable => 1,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{classify_with, EpubDuplicateCandidate, EpubDuplicateGroup, EpubDuplicateKind};
    use crate::commands::epub_analysis_cache::CachedEpubDigest;

    fn candidate(
        relative_path: &str,
        size_bytes: u64,
        identifier: Option<&str>,
    ) -> EpubDuplicateCandidate {
        EpubDuplicateCandidate {
            relative_path: relative_path.to_string(),
            size_bytes,
            identifier: identifier.map(str::to_string),
        }
    }

    fn digest(value: char) -> CachedEpubDigest {
        CachedEpubDigest {
            sha256: value.to_string().repeat(64),
        }
    }

    fn classify(
        candidates: &[EpubDuplicateCandidate],
        digests: &[(&str, char)],
    ) -> (Vec<EpubDuplicateGroup>, Vec<String>) {
        let digests = digests
            .iter()
            .map(|(path, marker)| ((*path).to_string(), digest(*marker)))
            .collect::<BTreeMap<_, _>>();
        let mut requested = Vec::new();
        let groups = classify_with(candidates, |path| {
            requested.push(path.to_string());
            digests
                .get(path)
                .cloned()
                .ok_or_else(|| format!("No digest fixture for {path}"))
        })
        .unwrap();
        (groups, requested)
    }

    #[test]
    fn identical_bytes_form_one_exact_group_even_when_identifiers_differ() {
        let candidates = [
            candidate("Second.epub", 100, Some("urn:second")),
            candidate("First.epub", 100, Some("urn:first")),
        ];
        let (groups, requested) =
            classify(&candidates, &[("First.epub", 'a'), ("Second.epub", 'a')]);

        assert_eq!(
            groups,
            vec![EpubDuplicateGroup {
                kind: EpubDuplicateKind::Exact,
                identity: "a".repeat(64),
                members: vec!["First.epub".to_string(), "Second.epub".to_string()],
            }]
        );
        assert_eq!(requested, vec!["First.epub", "Second.epub"]);
    }

    #[test]
    fn same_normalized_identifier_with_different_bytes_forms_one_probable_group() {
        let candidates = [
            candidate("First.epub", 100, Some("  urn:shared  ")),
            candidate("Second.epub", 100, Some("urn:shared")),
        ];
        let (groups, _) = classify(&candidates, &[("First.epub", 'a'), ("Second.epub", 'b')]);

        assert_eq!(
            groups,
            vec![EpubDuplicateGroup {
                kind: EpubDuplicateKind::Probable,
                identity: "urn:shared".to_string(),
                members: vec!["First.epub".to_string(), "Second.epub".to_string()],
            }]
        );
    }

    #[test]
    fn exact_peers_are_not_repeated_in_a_probable_group() {
        let candidates = [
            candidate("First.epub", 100, Some("urn:shared")),
            candidate("Second.epub", 100, Some("urn:shared")),
        ];
        let (groups, _) = classify(&candidates, &[("First.epub", 'a'), ("Second.epub", 'a')]);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].kind, EpubDuplicateKind::Exact);
    }

    #[test]
    fn unique_sizes_are_not_hashed_and_empty_identifiers_do_not_group() {
        let candidates = [
            candidate("One.epub", 10, None),
            candidate("Two.epub", 20, Some("")),
            candidate("Three.epub", 30, Some("   ")),
        ];
        let (groups, requested) = classify(&candidates, &[]);

        assert!(groups.is_empty());
        assert!(requested.is_empty());
    }

    #[test]
    fn groups_and_members_have_deterministic_order() {
        let candidates = [
            candidate("Zeta.epub", 300, Some("urn:zeta")),
            candidate("Alpha.epub", 200, Some("urn:zeta")),
            candidate("Middle.epub", 100, Some("urn:ignored")),
            candidate("Beta.epub", 100, Some("urn:ignored")),
            candidate("Delta.epub", 400, Some("urn:alpha")),
            candidate("Charlie.epub", 500, Some("urn:alpha")),
        ];
        let digests = [("Beta.epub", 'b'), ("Middle.epub", 'b')];
        let (first, _) = classify(&candidates, &digests);
        let mut reversed = candidates.to_vec();
        reversed.reverse();
        let (second, _) = classify(&reversed, &digests);

        assert_eq!(first, second);
        assert_eq!(
            first
                .iter()
                .map(|group| (group.kind, group.identity.clone(), group.members.clone()))
                .collect::<Vec<_>>(),
            vec![
                (
                    EpubDuplicateKind::Exact,
                    "b".repeat(64),
                    vec!["Beta.epub".to_string(), "Middle.epub".to_string()],
                ),
                (
                    EpubDuplicateKind::Probable,
                    "urn:alpha".to_string(),
                    vec!["Charlie.epub".to_string(), "Delta.epub".to_string()],
                ),
                (
                    EpubDuplicateKind::Probable,
                    "urn:zeta".to_string(),
                    vec!["Alpha.epub".to_string(), "Zeta.epub".to_string()],
                ),
            ]
        );
    }
}
