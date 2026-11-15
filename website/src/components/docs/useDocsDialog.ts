import { useEffect, type RefObject } from "react";

export function useDocsDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    dialog.showModal();
    // Native modality makes the background inert, but browsers may still Tab
    // into their own chrome. Keep the documented modal cycle inside the surface.
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>("a[href], button, input, summary, [tabindex]"),
      ).filter(
        (node) => node.tabIndex >= 0 && !node.matches(":disabled") && node.checkVisibility(),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", trapTab);
    return () => {
      dialog.removeEventListener("keydown", trapTab);
      dialog.close();
    };
  }, [ref, open]);
}
