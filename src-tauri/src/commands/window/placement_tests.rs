use super::*;

fn display(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Display {
    let bounds = PhysicalRect {
        position: PhysicalPosition::new(x, y),
        size: PhysicalSize::new(width, height),
    };
    Display {
        bounds,
        work: bounds,
        scale,
    }
}

#[test]
fn secondary_display_wins_over_primary_at_all_supported_scales() {
    let primary = display(0, 0, 1920, 1080, 1.0);
    for scale in [1.0, 1.25, 1.5] {
        let secondary = display(-2560, -400, 2560, 1440, scale);
        let selected =
            select_display(&[primary, secondary], Some(secondary), Some(primary)).unwrap();
        assert_eq!(selected, secondary);
        let size = tauri::LogicalSize::new(520.0, 620.0).to_physical::<u32>(selected.scale);
        let position = centered_position(selected.work, size);
        assert_eq!(position.x, -2560 + ((2560 - size.width) / 2) as i32);
        assert_eq!(position.y, -400 + ((1440 - size.height) / 2) as i32);
    }
}

#[test]
fn missing_invoker_and_disconnected_display_use_live_fallback() {
    let primary = display(0, 0, 1920, 1040, 1.0);
    let removed = display(-2560, 0, 2560, 1440, 1.5);
    for invoking in [None, Some(removed)] {
        assert_eq!(
            select_display(&[primary], invoking, Some(primary)),
            Some(primary)
        );
        assert_eq!(select_display(&[primary], invoking, None), Some(primary));
    }
    assert_eq!(select_display(&[], Some(removed), Some(primary)), None);
}

#[test]
fn selection_uses_updated_work_area_and_scale_for_live_display() {
    let old = display(1920, 0, 2560, 1440, 1.0);
    let mut live = old;
    live.scale = 1.5;
    live.work.position.y = 48;
    live.work.size.height -= 48;
    assert_eq!(select_display(&[live], Some(old), None), Some(live));
}

#[test]
fn taskbar_offsets_and_native_frame_fit_inside_work_area() {
    let mut target = display(1920, -100, 1280, 1000, 1.25);
    target.work.position.x += 60;
    target.work.position.y += 40;
    target.work.size = PhysicalSize::new(1220, 920);
    let spec = super::super::settings_window_spec();
    let frame = PhysicalSize::new(16, 8);
    let logical = fitted_size(
        tauri::LogicalSize::new(spec.width, spec.height),
        &spec,
        target,
        frame,
    );
    let inner = logical.to_physical::<u32>(target.scale);
    let outer = PhysicalSize::new(inner.width + frame.width, inner.height + frame.height);
    let position = centered_position(target.work, outer);
    assert!(position.x >= target.work.position.x && position.y >= target.work.position.y);
    assert!(
        position.x + outer.width as i32 <= target.work.position.x + target.work.size.width as i32
    );
    assert!(
        position.y + outer.height as i32 <= target.work.position.y + target.work.size.height as i32
    );
}

#[test]
fn undersized_work_area_retains_supported_minimum_and_accessible_top_left() {
    let target = display(-800, 40, 500, 400, 1.5);
    let spec = super::super::settings_window_spec();
    let size = fitted_size(
        tauri::LogicalSize::new(spec.width, spec.height),
        &spec,
        target,
        PhysicalSize::new(0, 0),
    );
    assert_eq!(
        size,
        tauri::LogicalSize::new(spec.min_width, spec.min_height)
    );
    assert_eq!(
        centered_position(target.work, size.to_physical(target.scale)),
        target.work.position
    );
    let fixed = super::super::archive_manager_window_spec();
    assert_eq!(
        fitted_size(size, &fixed, target, PhysicalSize::new(0, 0)),
        tauri::LogicalSize::new(860.0, 620.0)
    );
}

#[test]
fn manually_positioned_existing_windows_keep_their_position() {
    let primary = display(0, 0, 1920, 1040, 1.0);
    let secondary = display(-2560, -400, 2560, 1440, 1.5);
    for position in [
        PhysicalPosition::new(73, 81),
        PhysicalPosition::new(-2400, -200),
        PhysicalPosition::new(-40, 70),
    ] {
        let rect = PhysicalRect {
            position,
            size: PhysicalSize::new(780, 930),
        };
        assert!(titlebar_reachable(rect, 1.5, &[primary, secondary]));
    }
}

#[test]
fn slightly_clipped_titlebars_remain_reachable_at_both_vertical_edges() {
    for scale in [1.0, 1.25, 1.5] {
        for origin_y in [0, 40, -900] {
            let target = display(-1920, origin_y, 1920, 1080, scale);
            let strip_height = (32.0_f64 * scale).round() as i32;
            for clipped in [1, 3, 5] {
                for y in [origin_y - clipped, origin_y + 1080 - strip_height + clipped] {
                    let rect = PhysicalRect {
                        position: PhysicalPosition::new(-1800, y),
                        size: PhysicalSize::new(780, 930),
                    };
                    assert!(
                        titlebar_reachable(rect, scale, &[target]),
                        "scale={scale}, y={y}"
                    );
                }
            }
        }
    }
}

#[test]
fn visible_titlebar_height_boundary_is_symmetric_and_scaled() {
    for scale in [1.0, 1.25, 1.5] {
        let target = display(-1920, 40, 1920, 1080, scale);
        let strip_height = (32.0_f64 * scale).round() as i32;
        let minimum_visible = (16.0_f64 * scale).round() as i32;
        for visible in [
            0,
            1,
            minimum_visible - 1,
            minimum_visible,
            minimum_visible + 1,
        ] {
            for y in [40 - strip_height + visible, 1120 - visible] {
                assert_eq!(
                    titlebar_reachable(
                        PhysicalRect {
                            position: PhysicalPosition::new(-1800, y),
                            size: PhysicalSize::new(780, 930),
                        },
                        scale,
                        &[target]
                    ),
                    visible >= minimum_visible,
                    "scale={scale}, visible={visible}, y={y}"
                );
            }
        }
    }
}

#[test]
fn horizontal_reachability_boundary_is_unchanged() {
    for scale in [1.0, 1.25, 1.5] {
        let target = display(0, 0, 1920, 1080, scale);
        let minimum_visible = (96.0_f64 * scale).round() as i32;
        for visible in [minimum_visible - 1, minimum_visible] {
            for x in [visible - 780, 1920 - visible] {
                assert_eq!(
                    titlebar_reachable(
                        PhysicalRect {
                            position: PhysicalPosition::new(x, 50),
                            size: PhysicalSize::new(780, 930),
                        },
                        scale,
                        &[target]
                    ),
                    visible >= minimum_visible
                );
            }
        }
    }
}

#[test]
fn disconnect_or_titlebar_outside_work_area_requires_recovery() {
    let primary = display(0, 40, 1920, 1000, 1.0);
    for position in [
        PhysicalPosition::new(-2400, 80),
        PhysicalPosition::new(70, -200),
        PhysicalPosition::new(1900, 80),
        PhysicalPosition::new(70, 1030),
    ] {
        assert!(!titlebar_reachable(
            PhysicalRect {
                position,
                size: PhysicalSize::new(780, 930)
            },
            1.0,
            &[primary]
        ));
    }
}
