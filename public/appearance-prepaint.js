/* Read-only document presentation. AppearanceRuntime owns the subsequent token handoff. */
(() => {
  const root = document.documentElement;
  let presentation = window.__ARCHEION_APPEARANCE_PREPAINT__;
  if (window.__TAURI_INTERNALS__) {
    try {
      // This local protocol returns an in-memory canonical selection and at most one
      // previously validated presentation. It performs no network/catalog enumeration.
      const request = new XMLHttpRequest();
      request.open("GET", "http://archeion-appearance.localhost/snapshot", false);
      request.send();
      if (request.status === 200) presentation = JSON.parse(request.responseText);
    } catch {
      /* CSS retains the explicit built-in dark fallback if native startup is unavailable. */
    }
  }
  const color = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  const palette = (value) => value && color(value.background) && color(value.foreground);
  if (
    !presentation ||
    presentation.schemaVersion !== 1 ||
    !Number.isSafeInteger(presentation.settingsRevision) ||
    presentation.settingsRevision < 0 ||
    !["dark", "light"].includes(presentation.base) ||
    !["builtin", "custom", "system"].includes(presentation.selection?.kind) ||
    !palette(presentation) ||
    !palette(presentation.dark) ||
    !palette(presentation.light)
  )
    return;
  const media = matchMedia("(prefers-color-scheme: light)");
  const apply = () => {
    if (!root.hasAttribute("data-appearance-pending")) return;
    const selected =
      presentation.selection?.kind === "system"
        ? media.matches
          ? presentation.light
          : presentation.dark
        : presentation;
    root.style.setProperty("--appearance-startup-background", selected.background);
    root.style.setProperty("--appearance-startup-foreground", selected.foreground);
    root.style.setProperty(
      "--appearance-startup-scheme",
      presentation.selection?.kind === "system"
        ? media.matches
          ? "light"
          : "dark"
        : presentation.base,
    );
  };
  apply();
  if (presentation.selection?.kind === "system") {
    media.addEventListener("change", apply);
    new MutationObserver((_, observer) => {
      if (!root.hasAttribute("data-appearance-pending")) {
        media.removeEventListener("change", apply);
        observer.disconnect();
      }
    }).observe(root, { attributes: true, attributeFilter: ["data-appearance-pending"] });
  }
})();
