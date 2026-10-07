use std::sync::OnceLock;

#[cfg(target_os = "windows")]
mod windows;

/// One immutable catalog per application process, shared by all windows.
#[derive(Default)]
pub struct FontCatalog {
    families: OnceLock<Vec<String>>,
}

impl FontCatalog {
    pub const fn new() -> Self {
        Self {
            families: OnceLock::new(),
        }
    }

    pub fn families(&self) -> &[String] {
        self.load(enumerate_families)
    }

    fn load(&self, enumerate: impl FnOnce() -> Result<Vec<String>, String>) -> &[String] {
        self.families.get_or_init(|| match enumerate() {
            Ok(names) => normalize_families(names),
            Err(error) => {
                eprintln!("Installed font catalog unavailable: {error}");
                Vec::new()
            }
        })
    }
}

#[cfg(target_os = "windows")]
fn enumerate_families() -> Result<Vec<String>, String> {
    windows::enumerate_families().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn enumerate_families() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

fn normalize_families(names: Vec<String>) -> Vec<String> {
    let mut entries: Vec<_> = names
        .into_iter()
        .filter(|name| !name.chars().any(char::is_control))
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .map(|name| {
            let mixed_case =
                name.chars().any(char::is_uppercase) && name.chars().any(char::is_lowercase);
            (name.to_lowercase(), !mixed_case, name)
        })
        .collect();
    // Prefer mixed display casing over all-caps/lowercase duplicates, then a
    // stable lexical tie-breaker. Provider order must not affect the result.
    entries.sort();
    entries.dedup_by(|next, previous| next.0 == previous.0);
    entries.into_iter().map(|(_, _, name)| name).collect()
}

#[cfg(any(target_os = "windows", test))]
fn localized_name_index(locales: &[String], user_locale: Option<&str>) -> Option<usize> {
    user_locale
        .and_then(|user| {
            locales
                .iter()
                .position(|locale| locale.eq_ignore_ascii_case(user))
        })
        .or_else(|| {
            locales
                .iter()
                .position(|locale| locale.eq_ignore_ascii_case("en-us"))
        })
        .or_else(|| (!locales.is_empty()).then_some(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn strings(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn trims_drops_empty_and_rejects_control_characters() {
        assert_eq!(
            normalize_families(strings(&[
                "",
                "  ",
                "\t\n",
                "Bad\0Name",
                "Bad\u{85}Name",
                "  Noto Sans 日本語  ",
                "8514oem"
            ])),
            strings(&["8514oem", "Noto Sans 日本語"])
        );
    }

    #[test]
    fn deduplicates_with_readable_casing_and_orders_independently_of_input() {
        let names = strings(&[
            "segoe ui", "Arial", "SEGOE UI", "Segoe UI", "arial", "ARIAL", "Georgia", "8514oem",
            "école", "École",
        ]);
        let expected = strings(&["8514oem", "Arial", "Georgia", "Segoe UI", "École"]);
        assert_eq!(normalize_families(names.clone()), expected);
        assert_eq!(
            normalize_families(names.into_iter().rev().collect()),
            expected
        );
        assert_eq!(
            normalize_families(strings(&["aBc", "Abc"])),
            strings(&["Abc"])
        );
    }

    #[test]
    fn localized_names_prefer_user_then_english_then_first() {
        let locales = strings(&["ja-jp", "en-US", "vi-vn"]);
        assert_eq!(localized_name_index(&locales, Some("VI-VN")), Some(2));
        assert_eq!(localized_name_index(&locales, Some("fr-fr")), Some(1));
        assert_eq!(localized_name_index(&locales, None), Some(1));
        assert_eq!(
            localized_name_index(&strings(&["ja-jp", "vi-vn"]), Some("fr-fr")),
            Some(0)
        );
        assert_eq!(localized_name_index(&[], Some("en-us")), None);
    }

    #[test]
    fn caches_one_normalized_result_across_concurrent_consumers() {
        let catalog = FontCatalog::new();
        let calls = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    assert_eq!(
                        catalog.load(|| {
                            calls.fetch_add(1, Ordering::SeqCst);
                            Ok(strings(&[" Arial ", "arial"]))
                        }),
                        strings(&["Arial"])
                    );
                });
            }
        });
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn caches_unavailable_result_until_restart() {
        let catalog = FontCatalog::new();
        assert!(catalog
            .load(|| Err("DirectWrite unavailable".into()))
            .is_empty());
        assert!(catalog
            .load(|| panic!("failed catalog must not be enumerated again"))
            .is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_catalog_is_empty() {
        assert!(FontCatalog::new().families().is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_directwrite_returns_normalized_family_labels() {
        let names = enumerate_families().expect("Windows DirectWrite enumeration should succeed");
        let expected = normalize_families(names);
        assert!(
            !expected.is_empty(),
            "Windows runtime should have installed fonts"
        );
        assert_eq!(FontCatalog::new().families(), expected);
        assert!(expected
            .iter()
            .all(|name| !name.contains(['/', '\\']) && !name.contains(":\\")));
        eprintln!("DirectWrite runtime: {} installed families", expected.len());
    }
}
