import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const POPOVER_FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export function trapReaderPopoverFocus(
  event: ReactKeyboardEvent,
  popover: HTMLElement | null,
): void {
  if (!popover || event.key !== "Tab") return;
  const controls = Array.from(
    popover.querySelectorAll<HTMLElement>(POPOVER_FOCUSABLE_SELECTOR),
  ).filter((control) => !control.hasAttribute("disabled"));
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;

  if (controls.length === 1 || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
