//! Managed-window geometry. Called on the UI queue, after instance validation
//! and before reveal, so native move/resize queries observe the same transaction.
use tauri::{Manager, PhysicalPosition, PhysicalRect, PhysicalSize};

use super::ManagedWindowSpec;

#[derive(Clone, Copy, Debug)]
struct Display {
    bounds: PhysicalRect<i32, u32>,
    work: PhysicalRect<i32, u32>,
    scale: f64,
}

impl PartialEq for Display {
    fn eq(&self, other: &Self) -> bool {
        self.bounds.position == other.bounds.position
            && self.bounds.size == other.bounds.size
            && self.work.position == other.work.position
            && self.work.size == other.work.size
            && self.scale == other.scale
    }
}

impl Display {
    fn read(monitor: &tauri::Monitor) -> Option<Self> {
        let display = Self {
            bounds: PhysicalRect {
                position: *monitor.position(),
                size: *monitor.size(),
            },
            work: *monitor.work_area(),
            scale: monitor.scale_factor(),
        };
        (display.work.size.width > 0
            && display.work.size.height > 0
            && display.scale.is_finite()
            && display.scale > 0.0)
            .then_some(display)
    }
}

fn select_display(
    available: &[Display],
    invoking: Option<Display>,
    primary: Option<Display>,
) -> Option<Display> {
    // Only use live enumeration entries. A display can disappear while a shell
    // is loading; a stale current-monitor snapshot must not win over live data.
    [invoking, primary]
        .into_iter()
        .flatten()
        .find_map(|candidate| {
            available
                .iter()
                .find(|d| {
                    d.bounds.position == candidate.bounds.position
                        && d.bounds.size == candidate.bounds.size
                })
                .copied()
        })
        .or_else(|| available.first().copied())
}

fn displays(app: &tauri::AppHandle) -> (Vec<Display>, Option<Display>) {
    // On Windows current_monitor uses MonitorFromWindow, which uses the normal
    // rectangle for a minimized main window. Do not derive it from icon position.
    let invoking = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .as_ref()
        .and_then(Display::read);
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .as_ref()
        .and_then(Display::read);
    let available: Vec<Display> = match app.available_monitors() {
        Ok(monitors) => monitors.iter().filter_map(Display::read).collect(),
        // If enumeration itself fails, the OS primary monitor is the safest
        // independently queried fallback. An empty successful list stays empty.
        Err(_) => primary.into_iter().collect(),
    };
    let selected = select_display(&available, invoking, primary);
    (available, selected)
}

fn centered_position(
    work: PhysicalRect<i32, u32>,
    size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    fn axis(origin: i32, available: u32, extent: u32) -> i32 {
        // Oversized windows keep their titlebar at the work-area origin. Do not
        // hide the top half by centering a window larger than the display.
        (i64::from(origin) + i64::from(available.saturating_sub(extent)) / 2)
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    }
    PhysicalPosition::new(
        axis(work.position.x, work.size.width, size.width),
        axis(work.position.y, work.size.height, size.height),
    )
}

fn fitted_size(
    desired: tauri::LogicalSize<f64>,
    spec: &ManagedWindowSpec,
    display: Display,
    frame: PhysicalSize<u32>,
) -> tauri::LogicalSize<f64> {
    if !spec.resizable {
        return tauri::LogicalSize::new(spec.width, spec.height);
    }
    tauri::LogicalSize::new(
        desired
            .width
            .min(f64::from(display.work.size.width.saturating_sub(frame.width)) / display.scale)
            .max(spec.min_width),
        desired
            .height
            .min(f64::from(display.work.size.height.saturating_sub(frame.height)) / display.scale)
            .max(spec.min_height),
    )
}

const TITLEBAR_DRAG_WIDTH: f64 = 96.0;
const TITLEBAR_DRAG_HEIGHT: f64 = 32.0;
// Require half the drag strip's height to remain visible. This tolerates minor
// edge clipping while rejecting thin slivers that cannot provide a usable grip.
const MIN_VISIBLE_TITLEBAR_HEIGHT: f64 = 16.0;

fn titlebar_reachable(rect: PhysicalRect<i32, u32>, scale: f64, available: &[Display]) -> bool {
    fn overlap(start: i32, length: i64, work_start: i32, work_length: u32) -> i64 {
        ((i64::from(start) + length).min(i64::from(work_start) + i64::from(work_length))
            - i64::from(start).max(i64::from(work_start)))
        .max(0)
    }

    // Keep deliberately moved, partially off-screen windows where their drag
    // region is still usable. Recover only an inaccessible titlebar.
    let grip_width = (TITLEBAR_DRAG_WIDTH * scale)
        .round()
        .min(f64::from(rect.size.width)) as i64;
    let grip_height = (TITLEBAR_DRAG_HEIGHT * scale)
        .round()
        .min(f64::from(rect.size.height)) as i64;
    let minimum_visible_height = (MIN_VISIBLE_TITLEBAR_HEIGHT * scale)
        .round()
        .min(grip_height as f64) as i64;
    available.iter().any(|display| {
        let work = display.work;
        overlap(
            rect.position.x,
            i64::from(rect.size.width),
            work.position.x,
            work.size.width,
        ) >= grip_width
            && overlap(
                rect.position.y,
                grip_height,
                work.position.y,
                work.size.height,
            ) >= minimum_visible_height
    })
}

pub(super) fn prepare_reveal(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    spec: &ManagedWindowSpec,
    first: bool,
) -> Result<(), String> {
    let (available, selected) = displays(app);
    let Some(display) = selected else {
        // No usable native geometry: retain the explicit OS centering fallback
        // only for new windows. Never reset a healthy existing window here.
        return if first {
            window.center().map_err(|e| e.to_string())
        } else {
            Ok(())
        };
    };
    let desired = if first {
        tauri::LogicalSize::new(spec.width, spec.height)
    } else {
        // The reveal owner restores a minimized window only if it owns focus.
        // Otherwise leave its restore position alone, without reading icon
        // coordinates or activating a superseded invocation.
        if window.is_minimized().map_err(|e| e.to_string())? {
            return Ok(());
        }
        // Windows owns maximized bounds, including shadow margins outside the
        // work area, and relocates them when a display is removed. A reopen
        // must not mistake those margins for a stranded normal window.
        if window.is_maximized().map_err(|e| e.to_string())? {
            return Ok(());
        }
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let rect = PhysicalRect {
            position: window.outer_position().map_err(|e| e.to_string())?,
            size: window.outer_size().map_err(|e| e.to_string())?,
        };
        if titlebar_reachable(rect, scale, &available) {
            return Ok(());
        }
        window
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical(scale)
    };

    // Move while hidden to establish target DPI before applying logical sizes.
    // Keep virtual desktop origins physical: dividing a negative/global origin
    // by the target scale would move the window to the wrong display.
    window
        .set_position(display.work.position)
        .map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let frame = PhysicalSize::new(
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    window
        .set_size(fitted_size(desired, spec, display, frame))
        .map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    window
        .set_position(centered_position(display.work, size))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "placement_tests.rs"]
mod tests;
