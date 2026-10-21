use super::tests::{custom, presentation, settings};
use super::*;

fn system_presentation(light: bool) -> AppearancePresentation {
    let palette = if light {
        &palettes().light
    } else {
        &palettes().dark
    };
    AppearancePresentation {
        selection: AppThemeSelection::System,
        settings_revision: 11,
        base: if light { "light" } else { "dark" }.into(),
        background: palette.background.clone(),
        foreground: palette.foreground.clone(),
        manifest_source: None,
    }
}

fn native_event(service: &AppAppearanceService, light: bool) {
    // The same typed ThemeChanged dispatch consumed by the production window hook.
    service
        .observe_system_event(&tauri::WindowEvent::ThemeChanged(if light {
            tauri::Theme::Light
        } else {
            tauri::Theme::Dark
        }))
        .unwrap();
}

fn assert_native_system(service: &AppAppearanceService, light: bool) {
    let canonical = settings(AppThemeSelection::System, 11);
    let expected = if light {
        &palettes().light
    } else {
        &palettes().dark
    };
    let prepaint_snapshot = service.snapshot(&canonical, 0, None).unwrap();
    assert_eq!(
        &prepaint_snapshot.palette, expected,
        "prepaint must retain the native scheme"
    );
    assert_eq!(prepaint_snapshot.base, if light { "light" } else { "dark" });
    assert_eq!(
        service.native_background(&canonical, 0, None).unwrap(),
        palette_color(expected),
        "the actual native background projection must agree with prepaint",
    );
}

fn stale_after_newer_presentation(newer_light: bool) {
    let service = AppAppearanceService::default();
    native_event(&service, newer_light);
    let canonical = settings(AppThemeSelection::System, 11);
    service
        .prepare(&canonical, 0, None, system_presentation(newer_light))
        .unwrap();
    let stale = service.prepare(&canonical, 0, None, system_presentation(!newer_light));
    assert_native_system(&service, newer_light);
    assert!(
        stale.is_err(),
        "an opposing stale preparation must be rejected"
    );
}

#[test]
fn stale_light_cannot_overwrite_newer_dark_at_the_same_settings_revision() {
    stale_after_newer_presentation(false);
}

#[test]
fn stale_dark_cannot_overwrite_newer_light_at_the_same_settings_revision() {
    stale_after_newer_presentation(true);
}

fn stale_after_native_event(newer_light: bool) {
    let service = AppAppearanceService::default();
    native_event(&service, !newer_light);
    let canonical = settings(AppThemeSelection::System, 11);
    service
        .prepare(&canonical, 0, None, system_presentation(!newer_light))
        .unwrap();
    native_event(&service, newer_light);
    let stale = service.prepare(&canonical, 0, None, system_presentation(!newer_light));
    assert_native_system(&service, newer_light);
    assert!(stale.is_err());
}

#[test]
fn native_dark_theme_changed_fences_an_outstanding_light_command() {
    stale_after_native_event(false);
}

#[test]
fn native_light_theme_changed_fences_an_outstanding_dark_command() {
    stale_after_native_event(true);
}

#[test]
fn multiple_windows_and_restarted_runtimes_may_refresh_the_current_system_scheme() {
    let service = AppAppearanceService::default();
    let canonical = settings(AppThemeSelection::System, 11);
    for light in [false, true, false, true] {
        native_event(&service, light);
        // No per-window epoch can expire a valid main/settings/restarted runtime.
        for _window in ["main", "settings", "restarted-main"] {
            service
                .prepare(&canonical, 0, None, system_presentation(light))
                .unwrap();
            assert_native_system(&service, light);
        }
    }
}

#[test]
fn non_system_selection_supersedes_system_requests_without_changing_native_observation() {
    let service = AppAppearanceService::default();
    native_event(&service, false);
    let canonical = settings(
        AppThemeSelection::Builtin {
            id: BuiltInAppThemeId::Light,
        },
        12,
    );
    assert!(service
        .prepare(&canonical, 0, None, system_presentation(true))
        .is_err());
    assert_eq!(
        service.native_background(&canonical, 0, None).unwrap(),
        palette_color(&palettes().light)
    );
    assert_native_system(&service, false);
}

#[test]
fn native_scheme_events_do_not_change_custom_manifest_admission_or_invalidation() {
    let service = AppAppearanceService::default();
    let canonical = settings(custom(), 3);
    service
        .prepare(
            &canonical,
            7,
            Some("validated bytes"),
            presentation("validated bytes"),
        )
        .unwrap();
    for light in [true, false] {
        native_event(&service, light);
        assert_eq!(
            service
                .snapshot(&canonical, 7, Some("validated bytes"))
                .unwrap()
                .palette
                .background,
            "#253b47"
        );
        assert_eq!(
            service
                .native_background(&canonical, 7, Some("validated bytes"))
                .unwrap(),
            tauri::window::Color(37, 59, 71, 255)
        );
        assert_eq!(
            service
                .snapshot(&canonical, 7, Some("replacement"))
                .unwrap()
                .palette,
            palettes().dark
        );
    }
}

#[test]
fn a_late_native_bootstrap_cannot_overwrite_a_theme_changed_event() {
    for current_light in [true, false] {
        let service = AppAppearanceService::default();
        assert!(service.needs_system_initialization().unwrap());
        // The initial window-theme getter is outstanding when this event arrives.
        native_event(&service, current_light);
        service
            .initialize_system_scheme(if current_light {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            })
            .unwrap();
        assert!(!service.needs_system_initialization().unwrap());
        assert_native_system(&service, current_light);
    }
}

#[test]
fn a_queued_background_application_reads_the_new_scheme_not_the_old_command_palette() {
    for newer_light in [true, false] {
        let service = AppAppearanceService::default();
        let canonical = settings(AppThemeSelection::System, 11);
        native_event(&service, !newer_light);
        service
            .prepare(&canonical, 0, None, system_presentation(!newer_light))
            .unwrap();
        // Match the command's UI task: defer the projection, not a captured color.
        let queued_application = || service.native_background(&canonical, 0, None).unwrap();
        native_event(&service, newer_light);
        assert_eq!(
            queued_application(),
            palette_color(if newer_light {
                &palettes().light
            } else {
                &palettes().dark
            })
        );
        assert_native_system(&service, newer_light);
    }
}

#[test]
fn system_initialization_uses_only_native_observations_and_is_shared_across_windows() {
    for current_light in [true, false] {
        let service = AppAppearanceService::default();
        let canonical = settings(AppThemeSelection::System, 11);
        assert!(service
            .prepare(&canonical, 0, None, system_presentation(!current_light))
            .is_err());
        assert!(service.needs_system_initialization().unwrap());
        let theme = if current_light {
            tauri::Theme::Light
        } else {
            tauri::Theme::Dark
        };
        service.initialize_system_scheme(theme).unwrap();
        // A second window's outstanding initialization is not a newer OS event.
        service
            .initialize_system_scheme(if current_light {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            })
            .unwrap();
        service
            .prepare(&canonical, 0, None, system_presentation(current_light))
            .unwrap();
        assert_native_system(&service, current_light);
        native_event(&service, !current_light);
        service
            .prepare(&canonical, 0, None, system_presentation(!current_light))
            .unwrap();
        assert_native_system(&service, !current_light);
    }
}

#[test]
fn a_queued_system_request_cannot_evict_a_newer_committed_custom_presentation() {
    let service = AppAppearanceService::default();
    native_event(&service, false);
    let old_request = system_presentation(false);
    // Canonical selection changes before the queued request reaches admission.
    let canonical = settings(custom(), 12);
    service
        .prepare(
            &canonical,
            7,
            Some("validated bytes"),
            presentation("validated bytes"),
        )
        .unwrap();
    assert!(service
        .prepare(&canonical, 7, Some("validated bytes"), old_request)
        .is_err());
    assert_eq!(
        service
            .snapshot(&canonical, 7, Some("validated bytes"))
            .unwrap()
            .palette
            .background,
        "#253b47"
    );
    assert_eq!(
        service
            .native_background(&canonical, 7, Some("validated bytes"))
            .unwrap(),
        tauri::window::Color(37, 59, 71, 255)
    );
}
