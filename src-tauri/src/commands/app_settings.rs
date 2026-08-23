use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::atomic_file::{
    transaction_path, AtomicReplaceError, BackupCleanup, PreparedAtomicFile, RealAtomicFileSystem,
    TemporaryWriteStage,
};
use tauri::{Emitter, Manager};

const APP_SETTINGS_FILE: &str = "settings.json";
const APP_SETTINGS_CHANGED_EVENT: &str = "app-settings-changed";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default)]
    pub animations_enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFilterSettings {
    #[serde(default)]
    pub series: Vec<String>,
    #[serde(default)]
    pub subjects: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub publishers: Vec<String>,
    #[serde(default)]
    pub reading_statuses: Vec<String>,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub missing_metadata: bool,
    #[serde(default)]
    pub missing_cover: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySmartViewSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_visible_smart_views")]
    pub visible: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookCollectionDisplaySettings {
    #[serde(default = "default_collection_card_size")]
    pub card_size: String,
    #[serde(default = "default_library_sort")]
    pub sort_by: String,
    #[serde(default = "default_library_view")]
    pub view_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderCollectionDisplaySettings {
    #[serde(default = "default_collection_card_size")]
    pub card_size: String,
    #[serde(default = "default_folder_sort")]
    pub sort_by: String,
    #[serde(default = "default_folder_view")]
    pub view_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeriesCollectionDisplaySettings {
    #[serde(default = "default_collection_card_size")]
    pub card_size: String,
    #[serde(default = "default_series_sort")]
    pub sort_by: String,
    #[serde(default = "default_series_view")]
    pub view_mode: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCollectionDisplaySettings {
    #[serde(default)]
    pub books: BookCollectionDisplaySettings,
    #[serde(default)]
    pub folders: FolderCollectionDisplaySettings,
    #[serde(default)]
    pub series: SeriesCollectionDisplaySettings,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDisplaySettings {
    pub collections: LibraryCollectionDisplaySettings,
    pub filters: LibraryFilterSettings,
    pub smart_views: LibrarySmartViewSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    #[serde(default = "default_reader_font_size")]
    pub font_size: f64,
    #[serde(default = "default_reader_font_family")]
    pub font_family: String,
    #[serde(default = "default_reader_line_height")]
    pub line_height: f64,
    #[serde(default = "default_reader_margin")]
    pub margin: f64,
    #[serde(default = "default_reader_theme")]
    pub theme: String,
    #[serde(default = "default_reader_progress_placement")]
    pub progress_placement: String,
    #[serde(default = "default_reader_mode")]
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesAndMetadataSettings {
    #[serde(default)]
    pub keep_epub_writeback_backup: bool,
    #[serde(default = "default_true")]
    pub live_watcher_enabled: bool,
    #[serde(default = "default_true")]
    pub scan_on_startup: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalImportSettings {
    #[serde(default = "default_import_conflict_action")]
    pub default_conflict_action: String,
    #[serde(default = "default_import_mode")]
    pub default_mode: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardBinding {
    #[serde(default)]
    pub alt: bool,
    pub key: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub shift: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardBindingWire {
    #[serde(default)]
    alt: bool,
    #[serde(default)]
    ctrl: bool,
    key: String,
    #[serde(default)]
    meta: bool,
    primary: Option<bool>,
    #[serde(default)]
    shift: bool,
}

impl<'de> Deserialize<'de> for KeyboardBinding {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = KeyboardBindingWire::deserialize(deserializer)?;
        Ok(Self {
            alt: wire.alt,
            key: wire.key,
            primary: wire.primary.unwrap_or(wire.ctrl || wire.meta),
            shift: wire.shift,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardShortcutOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<KeyboardBinding>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardPreferences {
    #[serde(default)]
    pub shortcuts: HashMap<String, KeyboardShortcutOverride>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedNavigationState {
    pub archive_id: String,
    pub book_id: String,
    pub last_route: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWindowState {
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
    pub width: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub app_theme_preset: String,
    pub appearance: AppearanceSettings,
    pub confirm_destructive_file_actions: bool,
    pub density: String,
    pub files_and_metadata: FilesAndMetadataSettings,
    pub import: GlobalImportSettings,
    pub keyboard: KeyboardPreferences,
    pub library: LibraryDisplaySettings,
    pub navigation: Option<RememberedNavigationState>,
    pub reader: ReaderSettings,
    pub remember_window_state: bool,
    pub restore_last_reader: bool,
    pub show_continue_reading: bool,
    pub startup_behavior: String,
    pub window: Option<PersistedWindowState>,
}

impl<'de> Deserialize<'de> for AppPreferences {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(normalize_app_preferences_value(&value))
    }
}

fn default_app_theme_preset() -> String {
    "dark".to_string()
}
fn default_collection_card_size() -> String {
    "medium".to_string()
}
fn default_density() -> String {
    "comfortable".to_string()
}
fn default_import_conflict_action() -> String {
    "keepBoth".to_string()
}
fn default_import_mode() -> String {
    "copy".to_string()
}
fn default_folder_sort() -> String {
    "name".to_string()
}
fn default_folder_view() -> String {
    "list".to_string()
}
fn default_library_sort() -> String {
    "title".to_string()
}
fn default_library_view() -> String {
    "grid".to_string()
}
fn default_series_sort() -> String {
    "title".to_string()
}
fn default_series_view() -> String {
    "grid".to_string()
}
fn default_visible_smart_views() -> Vec<String> {
    [
        "unread",
        "in-progress",
        "completed",
        "needs-metadata",
        "needs-cover",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}
fn supported_smart_views() -> Vec<String> {
    default_visible_smart_views()
        .into_iter()
        .chain(["duplicates".to_string(), "epub-issues".to_string()])
        .collect()
}
fn default_reader_font_family() -> String {
    "serif".to_string()
}
fn default_reader_font_size() -> f64 {
    18.0
}
fn default_reader_line_height() -> f64 {
    1.6
}
fn default_reader_margin() -> f64 {
    48.0
}
fn default_reader_mode() -> String {
    "paged".to_string()
}
fn default_reader_progress_placement() -> String {
    "top".to_string()
}
fn default_reader_theme() -> String {
    "dark".to_string()
}
fn default_startup_behavior() -> String {
    "open-last-archive".to_string()
}
fn default_true() -> bool {
    true
}
fn is_false(value: &bool) -> bool {
    !*value
}
fn normalize_setting(value: Option<String>, supported: &[&str], fallback: &str) -> String {
    value
        .filter(|candidate| supported.contains(&candidate.as_str()))
        .unwrap_or_else(|| fallback.to_string())
}

fn object_field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    object.get(key).and_then(Value::as_object)
}

fn string_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_string)
}

fn true_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_bool) == Some(true)
}

fn false_field(object: &Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_bool) == Some(false)
}

fn number_field(object: &Map<String, Value>, key: &str) -> Option<f64> {
    object.get(key).and_then(Value::as_f64)
}

fn normalize_filter_values(values: Option<&Value>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for value in values.and_then(Value::as_array).into_iter().flatten() {
        let Some(value) = value.as_str() else {
            continue;
        };
        let display_value = value.trim();
        let key = display_value.to_lowercase();
        if !display_value.is_empty() && seen.insert(key) {
            normalized.push(display_value.to_string());
        }
    }

    normalized
}

fn normalize_library_filters(filters: Option<&Map<String, Value>>) -> LibraryFilterSettings {
    LibraryFilterSettings {
        series: normalize_filter_values(filters.and_then(|value| value.get("series"))),
        subjects: normalize_filter_values(filters.and_then(|value| value.get("subjects"))),
        languages: normalize_filter_values(filters.and_then(|value| value.get("languages"))),
        publishers: normalize_filter_values(filters.and_then(|value| value.get("publishers"))),
        reading_statuses: normalize_filter_values(
            filters.and_then(|value| value.get("readingStatuses")),
        )
        .into_iter()
        .map(|status| status.to_lowercase())
        .filter(|status| ["unread", "in-progress", "completed"].contains(&status.as_str()))
        .collect(),
        favorites_only: filters.is_some_and(|value| true_field(value, "favoritesOnly")),
        missing_metadata: filters.is_some_and(|value| true_field(value, "missingMetadata")),
        missing_cover: filters.is_some_and(|value| true_field(value, "missingCover")),
    }
}

fn normalize_smart_views(settings: Option<&Map<String, Value>>) -> LibrarySmartViewSettings {
    let requested: std::collections::HashSet<_> =
        normalize_filter_values(settings.and_then(|value| value.get("visible")))
            .into_iter()
            .collect();
    let visible: Vec<_> = supported_smart_views()
        .into_iter()
        .filter(|smart_view| requested.contains(smart_view))
        .collect();

    LibrarySmartViewSettings {
        enabled: settings.is_some_and(|value| true_field(value, "enabled")),
        visible: if visible.is_empty() {
            default_visible_smart_views()
        } else {
            visible
        },
    }
}

fn normalize_import_settings(settings: Option<&Map<String, Value>>) -> GlobalImportSettings {
    GlobalImportSettings {
        default_conflict_action: normalize_setting(
            settings.and_then(|value| string_field(value, "defaultConflictAction")),
            &["skip", "replace", "keepBoth"],
            "keepBoth",
        ),
        default_mode: normalize_setting(
            settings.and_then(|value| string_field(value, "defaultMode")),
            &["copy", "move"],
            "copy",
        ),
    }
}

fn normalize_binding_key(value: String) -> String {
    if value == " " {
        return "space".to_string();
    }

    match value.trim().to_lowercase().as_str() {
        "spacebar" => "space".to_string(),
        "esc" => "escape".to_string(),
        normalized => normalized.to_string(),
    }
}

#[derive(Clone, Copy)]
struct PersistedCommandDefinition {
    default_key: &'static str,
    default_primary: bool,
    default_shift: bool,
    id: &'static str,
    reader_only: bool,
}

const PERSISTED_COMMAND_DEFINITIONS: [PersistedCommandDefinition; 7] = [
    PersistedCommandDefinition {
        default_key: "p",
        default_primary: true,
        default_shift: true,
        id: "system.quick-actions",
        reader_only: false,
    },
    PersistedCommandDefinition {
        default_key: ",",
        default_primary: true,
        default_shift: false,
        id: "system.open-settings",
        reader_only: false,
    },
    PersistedCommandDefinition {
        default_key: "f",
        default_primary: true,
        default_shift: false,
        id: "surface.focus-search",
        reader_only: false,
    },
    PersistedCommandDefinition {
        default_key: "t",
        default_primary: false,
        default_shift: false,
        id: "reader.open-toc",
        reader_only: true,
    },
    PersistedCommandDefinition {
        default_key: "a",
        default_primary: false,
        default_shift: false,
        id: "reader.open-annotations",
        reader_only: true,
    },
    PersistedCommandDefinition {
        default_key: "b",
        default_primary: false,
        default_shift: false,
        id: "reader.toggle-bookmark",
        reader_only: true,
    },
    PersistedCommandDefinition {
        default_key: "s",
        default_primary: false,
        default_shift: false,
        id: "reader.open-reading-settings",
        reader_only: true,
    },
];

fn default_keyboard_binding(definition: PersistedCommandDefinition) -> KeyboardBinding {
    KeyboardBinding {
        alt: false,
        key: definition.default_key.to_string(),
        primary: definition.default_primary,
        shift: definition.default_shift,
    }
}

fn keyboard_bindings_equal(left: &KeyboardBinding, right: &KeyboardBinding) -> bool {
    left.alt == right.alt
        && left.key == right.key
        && left.primary == right.primary
        && left.shift == right.shift
}

fn keyboard_binding_signature(binding: &KeyboardBinding) -> String {
    let mut parts = Vec::new();
    if binding.primary {
        parts.push("primary");
    }
    if binding.alt {
        parts.push("alt");
    }
    if binding.shift {
        parts.push("shift");
    }
    parts.push(&binding.key);
    parts.join("+")
}

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('f').is_some_and(|digits| {
        (1..=2).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn keyboard_binding_violates_ownership(
    definition: PersistedCommandDefinition,
    binding: &KeyboardBinding,
) -> bool {
    const FIXED_INTERACTION_KEYS: [&str; 15] = [
        "arrowdown",
        "arrowleft",
        "arrowright",
        "arrowup",
        "contextmenu",
        "delete",
        "end",
        "enter",
        "escape",
        "f2",
        "home",
        "pagedown",
        "pageup",
        "space",
        "tab",
    ];
    const RESERVED_PRIMARY_BINDINGS: [&str; 8] = [
        "primary+l",
        "primary+n",
        "primary+p",
        "primary+r",
        "primary+t",
        "primary+w",
        "primary+shift+i",
        "primary+shift+r",
    ];
    const RESERVED_EDITING_BINDINGS: [&str; 9] = [
        "primary+a",
        "primary+c",
        "primary+v",
        "primary+x",
        "primary+y",
        "primary+z",
        "primary+shift+z",
        "primary+backspace",
        "primary+delete",
    ];

    if binding.alt
        || FIXED_INTERACTION_KEYS.contains(&binding.key.as_str())
        || is_function_key(&binding.key)
        || (!binding.primary && !definition.reader_only)
        || (!binding.primary
            && definition.reader_only
            && !(binding.key.len() == 1
                && binding
                    .key
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())))
    {
        return true;
    }

    let signature = keyboard_binding_signature(binding);
    RESERVED_PRIMARY_BINDINGS.contains(&signature.as_str())
        || RESERVED_EDITING_BINDINGS.contains(&signature.as_str())
}

fn parse_persisted_keyboard_binding(shortcut: &Map<String, Value>) -> Option<KeyboardBinding> {
    let stored_binding = object_field(shortcut, "binding")?;
    let key = normalize_binding_key(string_field(stored_binding, "key")?);
    if key.is_empty() {
        return None;
    }

    let primary = match stored_binding.get("primary") {
        None => true_field(stored_binding, "ctrl") || true_field(stored_binding, "meta"),
        Some(Value::Bool(value)) => *value,
        Some(_) => false,
    };
    Some(KeyboardBinding {
        alt: true_field(stored_binding, "alt"),
        key,
        primary,
        shift: true_field(stored_binding, "shift"),
    })
}

enum PersistedKeyboardCandidate {
    Default,
    Disabled,
    Override(KeyboardBinding),
}

fn effective_persisted_candidate_binding(
    definition: PersistedCommandDefinition,
    candidate: &PersistedKeyboardCandidate,
) -> Option<KeyboardBinding> {
    match candidate {
        PersistedKeyboardCandidate::Default => Some(default_keyboard_binding(definition)),
        PersistedKeyboardCandidate::Disabled => None,
        PersistedKeyboardCandidate::Override(binding) => Some(binding.clone()),
    }
}

fn find_persisted_candidate_conflict(
    candidates: &[PersistedKeyboardCandidate],
) -> Option<(usize, usize)> {
    for left_index in 0..PERSISTED_COMMAND_DEFINITIONS.len() {
        let Some(left_binding) = effective_persisted_candidate_binding(
            PERSISTED_COMMAND_DEFINITIONS[left_index],
            &candidates[left_index],
        ) else {
            continue;
        };

        for right_index in (left_index + 1)..PERSISTED_COMMAND_DEFINITIONS.len() {
            let Some(right_binding) = effective_persisted_candidate_binding(
                PERSISTED_COMMAND_DEFINITIONS[right_index],
                &candidates[right_index],
            ) else {
                continue;
            };
            if keyboard_bindings_equal(&left_binding, &right_binding) {
                return Some((left_index, right_index));
            }
        }
    }

    None
}

fn resolve_persisted_keyboard_candidates(candidates: &mut [PersistedKeyboardCandidate]) {
    for _ in 0..=PERSISTED_COMMAND_DEFINITIONS.len() {
        let Some((left_index, right_index)) = find_persisted_candidate_conflict(candidates) else {
            return;
        };

        let discard_index = match (&candidates[left_index], &candidates[right_index]) {
            (PersistedKeyboardCandidate::Override(_), PersistedKeyboardCandidate::Override(_)) => {
                right_index
            }
            (PersistedKeyboardCandidate::Override(_), PersistedKeyboardCandidate::Default) => {
                left_index
            }
            (PersistedKeyboardCandidate::Default, PersistedKeyboardCandidate::Override(_)) => {
                right_index
            }
            (PersistedKeyboardCandidate::Default, PersistedKeyboardCandidate::Default) => {
                panic!("configurable command defaults must not conflict")
            }
            _ => unreachable!("disabled commands have no effective binding"),
        };
        candidates[discard_index] = PersistedKeyboardCandidate::Default;
    }

    panic!("persisted keyboard conflict resolution exceeded the command bound")
}

fn normalize_keyboard_preferences(preferences: Option<&Map<String, Value>>) -> KeyboardPreferences {
    let stored_shortcuts = preferences.and_then(|value| object_field(value, "shortcuts"));
    let mut candidates: Vec<_> = PERSISTED_COMMAND_DEFINITIONS
        .into_iter()
        .map(|definition| {
            let Some(shortcut) = stored_shortcuts
                .and_then(|stored| stored.get(definition.id))
                .and_then(Value::as_object)
            else {
                return PersistedKeyboardCandidate::Default;
            };

            if true_field(shortcut, "disabled") {
                return PersistedKeyboardCandidate::Disabled;
            }

            let Some(binding) = parse_persisted_keyboard_binding(shortcut) else {
                return PersistedKeyboardCandidate::Default;
            };
            if keyboard_binding_violates_ownership(definition, &binding)
                || keyboard_bindings_equal(&binding, &default_keyboard_binding(definition))
            {
                return PersistedKeyboardCandidate::Default;
            }

            PersistedKeyboardCandidate::Override(binding)
        })
        .collect();
    resolve_persisted_keyboard_candidates(&mut candidates);

    let mut shortcuts = HashMap::new();
    for (definition, candidate) in PERSISTED_COMMAND_DEFINITIONS.into_iter().zip(candidates) {
        let shortcut = match candidate {
            PersistedKeyboardCandidate::Default => continue,
            PersistedKeyboardCandidate::Disabled => KeyboardShortcutOverride {
                binding: None,
                disabled: true,
            },
            PersistedKeyboardCandidate::Override(binding) => KeyboardShortcutOverride {
                binding: Some(binding),
                disabled: false,
            },
        };
        shortcuts.insert(definition.id.to_string(), shortcut);
    }

    assert!(find_persisted_candidate_conflict(
        &PERSISTED_COMMAND_DEFINITIONS
            .into_iter()
            .map(|definition| match shortcuts.get(definition.id) {
                Some(shortcut) if shortcut.disabled => PersistedKeyboardCandidate::Disabled,
                Some(shortcut) => PersistedKeyboardCandidate::Override(
                    shortcut
                        .binding
                        .clone()
                        .expect("enabled override has a binding"),
                ),
                None => PersistedKeyboardCandidate::Default,
            })
            .collect::<Vec<_>>()
    )
    .is_none());

    KeyboardPreferences { shortcuts }
}

fn normalize_navigation(
    navigation: Option<&Map<String, Value>>,
) -> Option<RememberedNavigationState> {
    let navigation = navigation?;
    let archive_id = string_field(navigation, "archiveId")?;
    let book_id = string_field(navigation, "bookId")?;
    let last_route = string_field(navigation, "lastRoute")?;
    let archive_id = archive_id.trim();
    let book_id = book_id.trim();
    let last_route = last_route.trim();
    let starts_at_beginning = last_route
        .split_once('?')
        .map(|(_, query)| query.split('&').any(|part| part == "start=beginning"))
        .unwrap_or(false);

    if archive_id.is_empty()
        || book_id.is_empty()
        || !last_route.starts_with("/reader/")
        || starts_at_beginning
    {
        return None;
    }

    Some(RememberedNavigationState {
        archive_id: archive_id.to_string(),
        book_id: book_id.to_string(),
        last_route: last_route.to_string(),
    })
}

fn number_in_range_or_default(value: f64, minimum: f64, maximum: f64, fallback: f64) -> f64 {
    if value.is_finite() && value >= minimum && value <= maximum {
        value
    } else {
        fallback
    }
}

fn normalize_reader_settings(settings: Option<&Map<String, Value>>) -> ReaderSettings {
    ReaderSettings {
        font_size: number_in_range_or_default(
            settings
                .and_then(|value| number_field(value, "fontSize"))
                .unwrap_or_else(default_reader_font_size),
            14.0,
            28.0,
            default_reader_font_size(),
        ),
        font_family: normalize_setting(
            settings.and_then(|value| string_field(value, "fontFamily")),
            &["serif", "sans", "system", "literata", "atkinson"],
            "serif",
        ),
        line_height: number_in_range_or_default(
            settings
                .and_then(|value| number_field(value, "lineHeight"))
                .unwrap_or_else(default_reader_line_height),
            1.4,
            2.0,
            default_reader_line_height(),
        ),
        margin: number_in_range_or_default(
            settings
                .and_then(|value| number_field(value, "margin"))
                .unwrap_or_else(default_reader_margin),
            24.0,
            72.0,
            default_reader_margin(),
        ),
        theme: normalize_setting(
            settings.and_then(|value| string_field(value, "theme")),
            &["light", "dark", "sepia"],
            "dark",
        ),
        progress_placement: normalize_setting(
            settings.and_then(|value| string_field(value, "progressPlacement")),
            &["top", "side"],
            "top",
        ),
        mode: normalize_setting(
            settings.and_then(|value| string_field(value, "mode")),
            &["paged", "continuous"],
            "paged",
        ),
    }
}

fn normalize_window_state(window: Option<&Map<String, Value>>) -> Option<PersistedWindowState> {
    let window = window?;
    let width = number_field(window, "width")?;
    let height = number_field(window, "height")?;
    let x = number_field(window, "x")?;
    let y = number_field(window, "y")?;
    if !width.is_finite()
        || !height.is_finite()
        || !x.is_finite()
        || !y.is_finite()
        || width <= 0.0
        || height <= 0.0
        || width > 100_000.0
        || height > 100_000.0
        || x.abs() > 1_000_000.0
        || y.abs() > 1_000_000.0
    {
        return None;
    }

    Some(PersistedWindowState {
        height: (height + 0.5).floor(),
        maximized: true_field(window, "maximized"),
        width: (width + 0.5).floor(),
        x: (x + 0.5).floor(),
        y: (y + 0.5).floor(),
    })
}

fn normalize_app_preferences_value(value: &Value) -> AppPreferences {
    let Some(settings) = value.as_object() else {
        return AppPreferences::default();
    };

    let appearance = object_field(settings, "appearance");
    let files_and_metadata = object_field(settings, "filesAndMetadata");

    AppPreferences {
        app_theme_preset: normalize_setting(
            string_field(settings, "appThemePreset"),
            &["system", "dark", "light"],
            "dark",
        ),
        appearance: AppearanceSettings {
            animations_enabled: appearance
                .is_some_and(|value| true_field(value, "animationsEnabled")),
        },
        confirm_destructive_file_actions: !false_field(settings, "confirmDestructiveFileActions"),
        density: normalize_setting(
            string_field(settings, "density"),
            &["comfortable", "compact"],
            "comfortable",
        ),
        files_and_metadata: FilesAndMetadataSettings {
            keep_epub_writeback_backup: files_and_metadata
                .is_some_and(|value| true_field(value, "keepEpubWritebackBackup")),
            live_watcher_enabled: files_and_metadata
                .is_none_or(|value| !false_field(value, "liveWatcherEnabled")),
            scan_on_startup: files_and_metadata
                .is_none_or(|value| !false_field(value, "scanOnStartup")),
        },
        import: normalize_import_settings(object_field(settings, "import")),
        keyboard: normalize_keyboard_preferences(object_field(settings, "keyboard")),
        library: LibraryDisplaySettings::from_value(
            settings.get("library"),
            settings.get("bookCardSize"),
        ),
        navigation: normalize_navigation(object_field(settings, "navigation")),
        reader: normalize_reader_settings(object_field(settings, "reader")),
        remember_window_state: true_field(settings, "rememberWindowState"),
        restore_last_reader: true_field(settings, "restoreLastReader"),
        show_continue_reading: !false_field(settings, "showContinueReading"),
        startup_behavior: normalize_setting(
            string_field(settings, "startupBehavior"),
            &["open-last-archive", "show-archive-manager"],
            "open-last-archive",
        ),
        window: normalize_window_state(object_field(settings, "window")),
    }
}

impl Default for BookCollectionDisplaySettings {
    fn default() -> Self {
        Self {
            card_size: default_collection_card_size(),
            sort_by: default_library_sort(),
            view_mode: default_library_view(),
        }
    }
}

impl Default for FolderCollectionDisplaySettings {
    fn default() -> Self {
        Self {
            card_size: default_collection_card_size(),
            sort_by: default_folder_sort(),
            view_mode: default_folder_view(),
        }
    }
}

impl Default for SeriesCollectionDisplaySettings {
    fn default() -> Self {
        Self {
            card_size: default_collection_card_size(),
            sort_by: default_series_sort(),
            view_mode: default_series_view(),
        }
    }
}

impl LibraryDisplaySettings {
    fn from_value(value: Option<&Value>, legacy_book_card_size: Option<&Value>) -> Self {
        let settings = value.and_then(Value::as_object);
        let collections = settings.and_then(|value| object_field(value, "collections"));
        let books = collections.and_then(|value| object_field(value, "books"));
        let folders = collections.and_then(|value| object_field(value, "folders"));
        let series = collections.and_then(|value| object_field(value, "series"));
        let legacy_view = normalize_setting(
            settings.and_then(|value| string_field(value, "viewMode")),
            &["grid", "list"],
            "grid",
        );
        let legacy_sort = normalize_setting(
            settings.and_then(|value| string_field(value, "sortBy")),
            &["title", "author", "recently-opened"],
            "title",
        );
        let legacy_card_size = normalize_setting(
            legacy_book_card_size
                .and_then(Value::as_str)
                .map(str::to_string),
            &["small", "medium", "large"],
            "medium",
        );

        Self {
            collections: LibraryCollectionDisplaySettings {
                books: BookCollectionDisplaySettings {
                    card_size: normalize_setting(
                        books.and_then(|value| string_field(value, "cardSize")),
                        &["small", "medium", "large"],
                        &legacy_card_size,
                    ),
                    sort_by: normalize_setting(
                        books.and_then(|value| string_field(value, "sortBy")),
                        &["title", "author", "recently-opened"],
                        &legacy_sort,
                    ),
                    view_mode: normalize_setting(
                        books.and_then(|value| string_field(value, "viewMode")),
                        &["grid", "list"],
                        &legacy_view,
                    ),
                },
                folders: FolderCollectionDisplaySettings {
                    card_size: normalize_setting(
                        folders.and_then(|value| string_field(value, "cardSize")),
                        &["small", "medium", "large"],
                        "medium",
                    ),
                    sort_by: normalize_setting(
                        folders.and_then(|value| string_field(value, "sortBy")),
                        &["name", "path", "most-books"],
                        "name",
                    ),
                    view_mode: normalize_setting(
                        folders.and_then(|value| string_field(value, "viewMode")),
                        &["cards", "list"],
                        "list",
                    ),
                },
                series: SeriesCollectionDisplaySettings {
                    card_size: normalize_setting(
                        series.and_then(|value| string_field(value, "cardSize")),
                        &["small", "medium", "large"],
                        "medium",
                    ),
                    sort_by: normalize_setting(
                        series.and_then(|value| string_field(value, "sortBy")),
                        &["title", "recently-opened", "most-volumes"],
                        "title",
                    ),
                    view_mode: normalize_setting(
                        series.and_then(|value| string_field(value, "viewMode")),
                        &["grid", "list"],
                        "grid",
                    ),
                },
            },
            filters: normalize_library_filters(
                settings.and_then(|value| object_field(value, "filters")),
            ),
            smart_views: normalize_smart_views(
                settings.and_then(|value| object_field(value, "smartViews")),
            ),
        }
    }
}

impl<'de> Deserialize<'de> for LibraryDisplaySettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(Self::from_value(Some(&value), None))
    }
}

impl Default for LibrarySmartViewSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            visible: default_visible_smart_views(),
        }
    }
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font_size: default_reader_font_size(),
            font_family: default_reader_font_family(),
            line_height: default_reader_line_height(),
            margin: default_reader_margin(),
            theme: default_reader_theme(),
            progress_placement: default_reader_progress_placement(),
            mode: default_reader_mode(),
        }
    }
}

impl Default for FilesAndMetadataSettings {
    fn default() -> Self {
        Self {
            keep_epub_writeback_backup: false,
            live_watcher_enabled: true,
            scan_on_startup: true,
        }
    }
}

impl Default for GlobalImportSettings {
    fn default() -> Self {
        Self {
            default_conflict_action: default_import_conflict_action(),
            default_mode: default_import_mode(),
        }
    }
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            app_theme_preset: default_app_theme_preset(),
            appearance: AppearanceSettings::default(),
            confirm_destructive_file_actions: true,
            density: default_density(),
            files_and_metadata: FilesAndMetadataSettings::default(),
            import: GlobalImportSettings::default(),
            keyboard: KeyboardPreferences::default(),
            library: LibraryDisplaySettings::default(),
            navigation: None,
            reader: ReaderSettings::default(),
            remember_window_state: false,
            restore_last_reader: false,
            show_continue_reading: true,
            startup_behavior: default_startup_behavior(),
            window: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "area", content = "value", rename_all = "camelCase")]
pub enum AppSettingsMutation {
    AppThemePreset(String),
    Appearance(AppearanceSettings),
    ConfirmDestructiveFileActions(bool),
    Density(String),
    FilesAndMetadata(FilesAndMetadataSettings),
    Import(GlobalImportSettings),
    Keyboard(KeyboardPreferences),
    Library(Box<LibraryDisplaySettings>),
    Navigation(Option<RememberedNavigationState>),
    Reader(Box<ReaderSettings>),
    RememberWindowState(bool),
    RestoreLastReader(bool),
    ShowContinueReading(bool),
    StartupBehavior(String),
    Window(Option<PersistedWindowState>),
}

impl AppSettingsMutation {
    fn apply(self, preferences: &mut AppPreferences) {
        match self {
            Self::AppThemePreset(value) => preferences.app_theme_preset = value,
            Self::Appearance(value) => preferences.appearance = value,
            Self::ConfirmDestructiveFileActions(value) => {
                preferences.confirm_destructive_file_actions = value;
            }
            Self::Density(value) => preferences.density = value,
            Self::FilesAndMetadata(value) => preferences.files_and_metadata = value,
            Self::Import(value) => preferences.import = value,
            Self::Keyboard(value) => preferences.keyboard = value,
            Self::Library(value) => preferences.library = *value,
            Self::Navigation(value) => preferences.navigation = value,
            Self::Reader(value) => preferences.reader = *value,
            Self::RememberWindowState(value) => preferences.remember_window_state = value,
            Self::RestoreLastReader(value) => preferences.restore_last_reader = value,
            Self::ShowContinueReading(value) => preferences.show_continue_reading = value,
            Self::StartupBehavior(value) => preferences.startup_behavior = value,
            Self::Window(value) => preferences.window = value,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsSnapshot {
    pub revision: u64,
    pub preferences: AppPreferences,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(APP_SETTINGS_FILE))
        .map_err(|error| format!("App settings directory is unavailable: {error}"))
}

fn app_settings_corrupt_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.corrupt-{timestamp}.bak"))
}

fn read_settings(path: &Path) -> Result<AppPreferences, String> {
    if !path.exists() {
        return Ok(AppPreferences::default());
    }

    let contents =
        fs::read(path).map_err(|error| format!("App settings could not be read: {error}"))?;
    match serde_json::from_slice(&contents) {
        Ok(preferences) => Ok(preferences),
        Err(_) => {
            fs::rename(path, app_settings_corrupt_path(path)).map_err(|error| {
                format!("Corrupted app settings could not be preserved: {error}")
            })?;
            let preferences = AppPreferences::default();
            write_settings(path, &preferences)?;
            Ok(preferences)
        }
    }
}

fn app_settings_temporary_write_error(error: crate::atomic_file::TemporaryWriteError) -> String {
    let stage = error.stage();
    let source = error.into_source();
    match stage {
        TemporaryWriteStage::Create => {
            format!("App settings temporary file could not be created: {source}")
        }
        TemporaryWriteStage::Write => {
            format!("App settings temporary file could not be written: {source}")
        }
        TemporaryWriteStage::Sync => {
            format!("App settings temporary file could not be synced: {source}")
        }
    }
}

fn app_settings_replace_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::DestinationNotFile => {
            "App settings path is not a file.".to_string()
        }
        AtomicReplaceError::MoveDestinationToBackup(error) => {
            format!("App settings backup could not be created: {error}")
        }
        AtomicReplaceError::ReplaceMissingDestination(error) => {
            format!("App settings file could not be replaced: {error}")
        }
        AtomicReplaceError::ReplaceRestored { replace_error } => format!(
            "App settings file could not be replaced and the previous file was restored: {replace_error}"
        ),
        AtomicReplaceError::RestoreFailed { restore_error } => format!(
            "App settings file could not be replaced and the previous file could not be restored: {restore_error}"
        ),
        AtomicReplaceError::RemoveBackup(error) => {
            format!("App settings transaction backup could not be removed: {error}")
        }
    }
}

fn write_settings(path: &Path, preferences: &AppPreferences) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("App settings directory could not be created: {error}"))?;
    }

    let contents = serde_json::to_vec_pretty(preferences)
        .map_err(|error| format!("App settings could not be serialized: {error}"))?;
    let temporary = PreparedAtomicFile::write(transaction_path(path, "tmp-write"), &contents)
        .map_err(app_settings_temporary_write_error)?;
    let backup = transaction_path(path, "write-backup");

    temporary
        .replace(
            path,
            &backup,
            BackupCleanup::Required,
            &RealAtomicFileSystem,
        )
        .map_err(app_settings_replace_error)
}

struct AppSettingsState {
    revision: u64,
    preferences: Option<AppPreferences>,
}

pub(crate) struct AppSettingsService {
    path: PathBuf,
    state: Mutex<AppSettingsState>,
}

impl AppSettingsService {
    pub(crate) fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self::new(settings_path(app)?))
    }

    fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: Mutex::new(AppSettingsState {
                revision: 0,
                preferences: None,
            }),
        }
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, AppSettingsState>, String> {
        self.state
            .lock()
            .map_err(|_| "App settings state is unavailable.".to_string())
    }

    fn load_preferences<'a>(
        &self,
        state: &'a mut AppSettingsState,
    ) -> Result<&'a AppPreferences, String> {
        if state.preferences.is_none() {
            state.preferences = Some(read_settings(&self.path)?);
        }
        state
            .preferences
            .as_ref()
            .ok_or_else(|| "App settings state is unavailable.".to_string())
    }

    fn load(&self) -> Result<AppPreferences, String> {
        let mut state = self.lock_state()?;
        Ok(self.load_preferences(&mut state)?.clone())
    }

    fn snapshot(&self) -> Result<AppSettingsSnapshot, String> {
        let mut state = self.lock_state()?;
        let preferences = self.load_preferences(&mut state)?.clone();
        Ok(AppSettingsSnapshot {
            revision: state.revision,
            preferences,
        })
    }

    fn save(&self, preferences: AppPreferences) -> Result<AppPreferences, String> {
        let mut state = self.lock_state()?;
        write_settings(&self.path, &preferences)?;
        state.preferences = Some(preferences.clone());
        Ok(preferences)
    }

    fn mutate(
        &self,
        mutation: AppSettingsMutation,
        publish: impl FnOnce(&AppSettingsSnapshot),
    ) -> Result<AppSettingsSnapshot, String> {
        let mut state = self.lock_state()?;
        let mut preferences = self.load_preferences(&mut state)?.clone();
        mutation.apply(&mut preferences);
        let value = serde_json::to_value(preferences)
            .map_err(|error| format!("App settings mutation could not be normalized: {error}"))?;
        let preferences = normalize_app_preferences_value(&value);
        let revision = state
            .revision
            .checked_add(1)
            .ok_or_else(|| "App settings revision is exhausted.".to_string())?;

        write_settings(&self.path, &preferences)?;
        state.preferences = Some(preferences.clone());
        state.revision = revision;
        let snapshot = AppSettingsSnapshot {
            revision,
            preferences,
        };
        drop(state);
        publish(&snapshot);
        Ok(snapshot)
    }
}

#[tauri::command]
pub fn load_app_settings(
    service: tauri::State<'_, AppSettingsService>,
) -> Result<AppPreferences, String> {
    service.load()
}

#[tauri::command]
pub fn load_app_settings_snapshot(
    service: tauri::State<'_, AppSettingsService>,
) -> Result<AppSettingsSnapshot, String> {
    service.snapshot()
}

#[tauri::command]
pub fn update_app_settings(
    app: tauri::AppHandle,
    service: tauri::State<'_, AppSettingsService>,
    mutation: AppSettingsMutation,
) -> Result<AppSettingsSnapshot, String> {
    service.mutate(mutation, |snapshot| {
        if let Err(error) = app.emit(APP_SETTINGS_CHANGED_EVENT, snapshot) {
            eprintln!("app settings change event failed: {error}");
        }
    })
}

#[tauri::command]
pub fn save_app_settings(
    service: tauri::State<'_, AppSettingsService>,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    service.save(preferences)
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        read_settings, write_settings, AppPreferences, AppSettingsMutation, AppSettingsService,
        AppearanceSettings, KeyboardBinding, KeyboardPreferences, KeyboardShortcutOverride,
        LibrarySmartViewSettings, ReaderSettings,
    };

    fn merge_expected(base: &mut Value, patch: &Value) {
        match (base, patch) {
            (Value::Object(base), Value::Object(patch)) => {
                for (key, value) in patch {
                    if let Some(existing) = base.get_mut(key) {
                        merge_expected(existing, value);
                    } else {
                        base.insert(key.clone(), value.clone());
                    }
                }
            }
            (base, patch) => *base = patch.clone(),
        }
    }

    #[test]
    fn app_preferences_match_the_shared_cross_language_fixture_corpus() {
        let corpus: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/app-settings/v1.json"))
                .expect("shared app settings fixtures should parse");
        assert_eq!(corpus["version"], 1);

        for fixture in corpus["cases"]
            .as_array()
            .expect("fixture cases should be an array")
        {
            let name = fixture["name"]
                .as_str()
                .expect("fixture should have a name");
            let mut expected = corpus["defaults"].clone();
            merge_expected(&mut expected, &fixture["expectedPatch"]);

            let normalized: AppPreferences = serde_json::from_value(fixture["input"].clone())
                .unwrap_or_else(|error| panic!("{name} should normalize: {error}"));
            let serialized = serde_json::to_value(&normalized)
                .unwrap_or_else(|error| panic!("{name} should serialize: {error}"));
            assert_eq!(serialized, expected, "{name}");

            let round_tripped: AppPreferences = serde_json::from_value(serialized)
                .unwrap_or_else(|error| panic!("{name} should round trip: {error}"));
            assert_eq!(round_tripped, normalized, "{name}");
        }
    }

    #[test]
    fn keyboard_normalization_uses_the_complete_intended_effective_state() {
        let disabled_later: AppPreferences = serde_json::from_value(serde_json::json!({
            "keyboard": {
                "shortcuts": {
                    "system.quick-actions": {
                        "binding": {
                            "key": "f",
                            "primary": true
                        }
                    },
                    "surface.focus-search": {
                        "disabled": true
                    }
                }
            }
        }))
        .expect("disabled later command should normalize");
        assert_eq!(
            serde_json::to_value(&disabled_later.keyboard)
                .expect("disabled keyboard state should serialize"),
            serde_json::json!({
                "shortcuts": {
                    "system.quick-actions": {
                        "binding": {
                            "alt": false,
                            "key": "f",
                            "primary": true,
                            "shift": false
                        }
                    },
                    "surface.focus-search": {
                        "disabled": true
                    }
                }
            })
        );

        let moved_later: AppPreferences = serde_json::from_str(
            r#"{
                "keyboard": {
                    "shortcuts": {
                        "surface.focus-search": {
                            "binding": { "key": "g", "primary": true }
                        },
                        "system.quick-actions": {
                            "binding": { "key": "f", "primary": true }
                        }
                    }
                }
            }"#,
        )
        .expect("reversed property order should normalize");
        assert_eq!(
            moved_later.keyboard.shortcuts.get("system.quick-actions"),
            Some(&KeyboardShortcutOverride {
                binding: Some(KeyboardBinding {
                    alt: false,
                    key: "f".to_string(),
                    primary: true,
                    shift: false,
                }),
                disabled: false,
            })
        );
        assert_eq!(
            moved_later.keyboard.shortcuts.get("surface.focus-search"),
            Some(&KeyboardShortcutOverride {
                binding: Some(KeyboardBinding {
                    alt: false,
                    key: "g".to_string(),
                    primary: true,
                    shift: false,
                }),
                disabled: false,
            })
        );

        let round_tripped: AppPreferences =
            serde_json::from_value(serde_json::to_value(&moved_later).expect("should serialize"))
                .expect("normalized preferences should round trip");
        assert_eq!(round_tripped, moved_later);
    }

    #[test]
    fn app_preferences_ignore_legacy_frame_style_without_losing_neighboring_settings() {
        let parsed: AppPreferences = serde_json::from_value(serde_json::json!({
            "density": "compact",
            "bookCardSize": "large",
            "showContinueReading": false,
            "windowFrameStyle": "native",
            "library": {
                "sortBy": "author",
                "viewMode": "list"
            }
        }))
        .expect("old app preferences should parse");

        assert_eq!(parsed.density, "compact");
        assert_eq!(parsed.library.collections.books.card_size, "large");
        assert!(!parsed.show_continue_reading);
        assert_eq!(parsed.startup_behavior, "open-last-archive");
        assert!(!parsed.appearance.animations_enabled);
        assert!(parsed.confirm_destructive_file_actions);
        assert_eq!(parsed.library.collections.books.sort_by, "author");
        assert_eq!(parsed.library.collections.books.view_mode, "list");
        assert_eq!(
            parsed.library.collections.folders,
            super::FolderCollectionDisplaySettings::default()
        );
        assert_eq!(
            parsed.library.collections.series,
            super::SeriesCollectionDisplaySettings::default()
        );
        assert_eq!(
            parsed.library.smart_views,
            LibrarySmartViewSettings::default()
        );
        assert!(parsed.library.filters.series.is_empty());
        assert!(parsed.library.filters.reading_statuses.is_empty());
        assert!(!parsed.library.filters.favorites_only);
        assert!(parsed.navigation.is_none());
        assert_eq!(parsed.reader.progress_placement, "top");
        assert_eq!(parsed.import.default_mode, "copy");
        assert!(!parsed.files_and_metadata.keep_epub_writeback_backup);
        assert!(parsed.keyboard.shortcuts.is_empty());
        assert!(parsed.window.is_none());

        let serialized = serde_json::to_value(parsed).expect("preferences should serialize");
        assert!(serialized.get("windowFrameStyle").is_none());
    }

    #[test]
    fn app_preferences_normalize_collection_fields_independently_and_emit_only_new_schema() {
        let parsed: AppPreferences = serde_json::from_value(serde_json::json!({
            "bookCardSize": "large",
            "library": {
                "sortBy": "author",
                "viewMode": "list",
                "collections": {
                    "books": {
                        "cardSize": "invalid",
                        "sortBy": "recently-opened",
                        "viewMode": "invalid"
                    },
                    "folders": {
                        "cardSize": "small",
                        "sortBy": "invalid",
                        "viewMode": "cards"
                    },
                    "series": {
                        "cardSize": "large",
                        "sortBy": "most-volumes",
                        "viewMode": "invalid"
                    }
                }
            }
        }))
        .expect("mixed collection settings should parse");

        assert_eq!(parsed.library.collections.books.card_size, "large");
        assert_eq!(parsed.library.collections.books.sort_by, "recently-opened");
        assert_eq!(parsed.library.collections.books.view_mode, "list");
        assert_eq!(parsed.library.collections.folders.card_size, "small");
        assert_eq!(parsed.library.collections.folders.sort_by, "name");
        assert_eq!(parsed.library.collections.folders.view_mode, "cards");
        assert_eq!(parsed.library.collections.series.card_size, "large");
        assert_eq!(parsed.library.collections.series.sort_by, "most-volumes");
        assert_eq!(parsed.library.collections.series.view_mode, "grid");

        let serialized = serde_json::to_value(parsed).expect("preferences should serialize");
        assert!(serialized.get("bookCardSize").is_none());
        assert!(serialized["library"].get("sortBy").is_none());
        assert!(serialized["library"].get("viewMode").is_none());
        assert_eq!(
            serialized["library"]["collections"]["folders"]["viewMode"],
            "cards"
        );
    }

    #[test]
    fn app_preferences_migrate_legacy_keyboard_modifiers_to_primary() {
        let parsed: AppPreferences = serde_json::from_value(serde_json::json!({
            "keyboard": {
                "shortcuts": {
                    "system.quick-actions": {
                        "binding": {
                            "alt": false,
                            "ctrl": true,
                            "key": "k",
                            "meta": false,
                            "shift": true
                        }
                    }
                }
            }
        }))
        .expect("legacy keyboard binding should parse");

        let binding = parsed
            .keyboard
            .shortcuts
            .get("system.quick-actions")
            .and_then(|shortcut| shortcut.binding.as_ref())
            .expect("binding should be preserved");
        assert!(binding.primary);
        assert_eq!(binding.key, "k");

        let serialized = serde_json::to_value(parsed).expect("preferences should serialize");
        let binding = &serialized["keyboard"]["shortcuts"]["system.quick-actions"]["binding"];
        assert_eq!(binding["primary"], true);
        assert!(binding.get("ctrl").is_none());
        assert!(binding.get("meta").is_none());
    }

    #[test]
    fn malformed_explicit_primary_does_not_use_legacy_modifier_fallback() {
        let parsed: AppPreferences = serde_json::from_value(serde_json::json!({
            "keyboard": {
                "shortcuts": {
                    "system.quick-actions": {
                        "binding": {
                            "ctrl": true,
                            "key": "k",
                            "primary": "invalid"
                        }
                    },
                    "system.open-settings": {
                        "binding": {
                            "key": "o",
                            "meta": true,
                            "primary": null
                        }
                    },
                    "reader.open-toc": {
                        "binding": {
                            "ctrl": true,
                            "key": "7",
                            "primary": false
                        }
                    },
                    "reader.open-annotations": {
                        "binding": {
                            "key": "q",
                            "meta": true
                        }
                    }
                }
            }
        }))
        .expect("primary presence cases should normalize");

        assert!(!parsed
            .keyboard
            .shortcuts
            .contains_key("system.quick-actions"));
        assert!(!parsed
            .keyboard
            .shortcuts
            .contains_key("system.open-settings"));
        assert!(
            !parsed.keyboard.shortcuts["reader.open-toc"]
                .binding
                .as_ref()
                .expect("explicit false Reader binding should survive")
                .primary
        );
        assert!(
            parsed.keyboard.shortcuts["reader.open-annotations"]
                .binding
                .as_ref()
                .expect("missing primary should use legacy Meta")
                .primary
        );
    }

    #[test]
    fn app_preferences_round_trip_through_settings_file() {
        let path = temporary_settings_path("round-trip");
        let preferences = AppPreferences {
            density: "compact".to_string(),
            appearance: AppearanceSettings {
                animations_enabled: true,
            },
            keyboard: KeyboardPreferences {
                shortcuts: [
                    (
                        "system.quick-actions".to_string(),
                        KeyboardShortcutOverride {
                            binding: Some(KeyboardBinding {
                                alt: false,
                                key: "k".to_string(),
                                primary: true,
                                shift: true,
                            }),
                            disabled: false,
                        },
                    ),
                    (
                        "system.open-settings".to_string(),
                        KeyboardShortcutOverride {
                            binding: None,
                            disabled: true,
                        },
                    ),
                ]
                .into_iter()
                .collect(),
            },
            library: super::LibraryDisplaySettings {
                collections: super::LibraryCollectionDisplaySettings {
                    books: super::BookCollectionDisplaySettings {
                        card_size: "large".to_string(),
                        sort_by: "author".to_string(),
                        view_mode: "list".to_string(),
                    },
                    folders: super::FolderCollectionDisplaySettings {
                        card_size: "small".to_string(),
                        sort_by: "most-books".to_string(),
                        view_mode: "cards".to_string(),
                    },
                    series: super::SeriesCollectionDisplaySettings {
                        card_size: "large".to_string(),
                        sort_by: "recently-opened".to_string(),
                        view_mode: "list".to_string(),
                    },
                },
                filters: super::LibraryFilterSettings {
                    languages: vec!["en".to_string()],
                    missing_cover: true,
                    ..super::LibraryFilterSettings::default()
                },
                smart_views: LibrarySmartViewSettings {
                    enabled: true,
                    visible: vec!["unread".to_string(), "needs-cover".to_string()],
                },
            },
            reader: super::ReaderSettings {
                mode: "continuous".to_string(),
                ..super::ReaderSettings::default()
            },
            ..AppPreferences::default()
        };

        write_settings(&path, &preferences).expect("settings should write");
        let loaded = read_settings(&path).expect("settings should read");
        let _ = std::fs::remove_file(&path);

        assert_eq!(loaded, preferences);
        assert_eq!(loaded.reader.mode, "continuous");
    }

    #[test]
    fn smart_view_preferences_round_trip_enabled_and_disabled_selections() {
        for (label, enabled, visible) in [
            (
                "enabled",
                true,
                vec![
                    "unread".to_string(),
                    "duplicates".to_string(),
                    "epub-issues".to_string(),
                ],
            ),
            (
                "disabled",
                false,
                vec!["in-progress".to_string(), "needs-metadata".to_string()],
            ),
        ] {
            let path = temporary_settings_path(label);
            let preferences = AppPreferences {
                library: super::LibraryDisplaySettings {
                    smart_views: LibrarySmartViewSettings { enabled, visible },
                    ..super::LibraryDisplaySettings::default()
                },
                ..AppPreferences::default()
            };

            write_settings(&path, &preferences).expect("settings should write");
            let loaded = read_settings(&path).expect("settings should read");
            let _ = std::fs::remove_file(&path);

            assert_eq!(loaded.library.smart_views, preferences.library.smart_views);
            assert_eq!(loaded, preferences);
        }
    }

    #[test]
    fn app_preferences_replace_existing_settings_file() {
        let path = temporary_settings_path("replace");
        let first = AppPreferences {
            density: "compact".to_string(),
            ..AppPreferences::default()
        };
        let second = AppPreferences {
            restore_last_reader: true,
            ..AppPreferences::default()
        };

        write_settings(&path, &first).expect("initial settings should write");
        write_settings(&path, &second).expect("replacement settings should write");
        let loaded = read_settings(&path).expect("settings should read");
        let write_backup_exists = path
            .parent()
            .expect("settings path should have parent")
            .read_dir()
            .expect("settings directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".write-backup-")
            });
        let _ = std::fs::remove_file(&path);

        assert_eq!(loaded, second);
        assert!(!write_backup_exists);
    }

    #[test]
    fn app_preferences_reject_non_file_destination_without_temporary_artifacts() {
        let path = temporary_settings_path("directory-conflict");
        std::fs::create_dir_all(&path).expect("conflicting directory should be created");

        let error = write_settings(&path, &AppPreferences::default())
            .expect_err("directory destination should be rejected");

        assert_eq!(error, "App settings path is not a file.");
        let parent = path.parent().expect("settings path should have a parent");
        let file_name = path
            .file_name()
            .expect("settings path should have a file name")
            .to_string_lossy();
        assert!(!parent
            .read_dir()
            .expect("settings directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                entry_name.starts_with(file_name.as_ref()) && entry_name.contains("tmp-write")
            }));
        std::fs::remove_dir_all(path).expect("conflicting directory should be removed");
    }

    #[test]
    fn app_preferences_recover_from_corrupted_settings_file() {
        let path = temporary_settings_path("corrupt");
        std::fs::write(&path, b"{not-json").expect("corrupt settings should be written");

        let loaded = read_settings(&path).expect("settings should recover");

        assert_eq!(loaded, AppPreferences::default());
        assert!(path.is_file());
        let backup_exists = path
            .parent()
            .expect("settings path should have parent")
            .read_dir()
            .expect("settings directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(backup_exists);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn app_settings_service_loads_one_normalized_snapshot() {
        let root = temporary_settings_root("service-load");
        std::fs::create_dir_all(&root).expect("settings root should be created");
        let path = root.join("settings.json");
        std::fs::write(
            &path,
            br#"{
                "density": "unsupported",
                "showContinueReading": false,
                "reader": { "mode": "continuous" }
            }"#,
        )
        .expect("settings should be written");
        let service = AppSettingsService::new(path.clone());

        let loaded = service.load().expect("settings should load");
        std::fs::write(&path, br#"{ "density": "compact" }"#)
            .expect("settings should be changed outside the service");
        let reloaded = service.load().expect("cached settings should load");

        assert_eq!(loaded.density, "comfortable");
        assert!(!loaded.show_continue_reading);
        assert_eq!(loaded.reader.mode, "continuous");
        assert_eq!(reloaded, loaded);
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn app_settings_service_recovers_corrupt_settings() {
        let root = temporary_settings_root("service-corrupt");
        std::fs::create_dir_all(&root).expect("settings root should be created");
        let path = root.join("settings.json");
        std::fs::write(&path, b"{not-json").expect("corrupt settings should be written");
        let service = AppSettingsService::new(path.clone());

        let loaded = service.load().expect("settings should recover");

        assert_eq!(loaded, AppPreferences::default());
        assert!(path.is_file());
        assert!(root
            .read_dir()
            .expect("settings root should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn app_settings_service_persists_with_atomic_replacement() {
        let root = temporary_settings_root("service-replace");
        let path = root.join("settings.json");
        let service = AppSettingsService::new(path.clone());
        let first = AppPreferences {
            density: "compact".to_string(),
            ..AppPreferences::default()
        };
        let second = AppPreferences {
            restore_last_reader: true,
            ..AppPreferences::default()
        };

        service.save(first).expect("initial settings should save");
        service
            .save(second.clone())
            .expect("replacement settings should save");

        assert_eq!(read_settings(&path).expect("settings should read"), second);
        assert_eq!(
            root.read_dir()
                .expect("settings root should be readable")
                .count(),
            1
        );
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn app_settings_service_keeps_snapshot_when_persistence_fails() {
        let root = temporary_settings_root("service-failure");
        let path = root.join("settings.json");
        let service = AppSettingsService::new(path.clone());
        let accepted = AppPreferences {
            density: "compact".to_string(),
            ..AppPreferences::default()
        };
        service
            .save(accepted.clone())
            .expect("initial settings should save");
        std::fs::remove_file(&path).expect("settings file should be removed");
        std::fs::create_dir(&path).expect("conflicting destination should be created");

        let rejected = AppPreferences {
            restore_last_reader: true,
            ..AppPreferences::default()
        };
        assert_eq!(
            service.save(rejected).expect_err("replacement should fail"),
            "App settings path is not a file."
        );
        assert_eq!(
            service.load().expect("last valid snapshot should remain"),
            accepted
        );
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn typed_mutations_preserve_unrelated_preference_areas() {
        let root = temporary_settings_root("typed-areas");
        let service = AppSettingsService::new(root.join("settings.json"));
        let published = std::cell::RefCell::new(Vec::new());

        let first = service
            .mutate(
                AppSettingsMutation::Density("compact".to_string()),
                |event| {
                    published.borrow_mut().push(event.clone());
                },
            )
            .expect("density should update");
        let second = service
            .mutate(
                AppSettingsMutation::Reader(Box::new(ReaderSettings {
                    mode: "continuous".to_string(),
                    ..ReaderSettings::default()
                })),
                |event| published.borrow_mut().push(event.clone()),
            )
            .expect("reader settings should update");

        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        assert_eq!(second.preferences.density, "compact");
        assert_eq!(second.preferences.reader.mode, "continuous");
        assert_eq!(published.borrow().as_slice(), &[first, second.clone()]);
        assert_eq!(
            read_settings(&root.join("settings.json")).expect("settings should persist"),
            second.preferences
        );
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn failed_typed_mutation_does_not_advance_or_publish_revision() {
        let root = temporary_settings_root("typed-failure");
        let path = root.join("settings.json");
        let service = AppSettingsService::new(path.clone());
        let published = std::cell::RefCell::new(Vec::new());
        let accepted = service
            .mutate(
                AppSettingsMutation::Density("compact".to_string()),
                |event| {
                    published.borrow_mut().push(event.clone());
                },
            )
            .expect("initial mutation should persist");
        std::fs::remove_file(&path).expect("settings file should be removed");
        std::fs::create_dir(&path).expect("conflicting destination should be created");

        let error = service
            .mutate(AppSettingsMutation::RestoreLastReader(true), |event| {
                published.borrow_mut().push(event.clone())
            })
            .expect_err("mutation persistence should fail");

        assert_eq!(error, "App settings path is not a file.");
        assert_eq!(
            published.borrow().as_slice(),
            std::slice::from_ref(&accepted)
        );
        assert_eq!(
            service
                .snapshot()
                .expect("snapshot should remain available"),
            accepted
        );
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    #[test]
    fn typed_mutation_input_uses_canonical_normalization() {
        let root = temporary_settings_root("typed-normalization");
        let service = AppSettingsService::new(root.join("settings.json"));

        let density_mutation: AppSettingsMutation = serde_json::from_value(serde_json::json!({
            "area": "density",
            "value": "unsupported"
        }))
        .expect("typed density mutation should deserialize");
        let density = service
            .mutate(density_mutation, |_| {})
            .expect("density mutation should normalize");
        let reader_mutation: AppSettingsMutation = serde_json::from_value(serde_json::json!({
            "area": "reader",
            "value": {
                "fontSize": 500,
                "fontFamily": "serif",
                "lineHeight": 0.1,
                "margin": -20,
                "theme": "dark",
                "progressPlacement": "top",
                "mode": "unsupported"
            }
        }))
        .expect("typed reader mutation should deserialize");
        let reader = service
            .mutate(reader_mutation, |_| {})
            .expect("reader mutation should normalize");

        assert_eq!(density.preferences.density, "comfortable");
        assert_eq!(reader.revision, 2);
        assert_eq!(reader.preferences.reader, ReaderSettings::default());
        std::fs::remove_dir_all(root).expect("settings root should be removed");
    }

    fn temporary_settings_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "archeion-app-settings-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should be available")
                .as_nanos()
        ))
    }

    fn temporary_settings_path(label: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "archeion-app-settings-{label}-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should be available")
                .as_nanos()
        ));
        path
    }
}
