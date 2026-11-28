import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { BrowserFixture } from "./views";
import { APPLICATION_VERSION_FALLBACK } from "../../../src/app/appVersion";
import { shellStressThemes } from "../../fixtures/themes/shellStressThemes";
import { resolveAppTheme, resolveTheme } from "../../../src/themes/resolveTheme";
import { applyResolvedAppTheme } from "../../../src/themes/themeCssVariables";
import { validateThemeManifest } from "../../../src/themes/validateThemeManifest";
import "../../../src/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Browser fixture root is missing.");
const params = new URLSearchParams(window.location.search);
const stressTheme = params.get("themeStress");
if (params.has("light")) {
  applyResolvedAppTheme(document.documentElement, resolveAppTheme("light", {}));
}
if (stressTheme !== null) {
  if (stressTheme !== "equal" && stressTheme !== "distinct")
    throw new Error("Unknown shell stress theme.");
  const validation = validateThemeManifest(shellStressThemes[stressTheme]);
  if (!validation.ok) throw new Error("Shell stress theme must pass schema-v1 validation.");
  applyResolvedAppTheme(document.documentElement, resolveTheme(validation.manifest).app);
}
const view = params.get("view");
if (
  view === "library" ||
  view === "library-updates" ||
  view === "archive-shell" ||
  view === "about-updates"
) {
  // Exercise the real titlebar without invoking native window operations.
  Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
  mockWindows(
    view === "archive-shell" ? "archive-manager" : view === "about-updates" ? "about" : "main",
  );
  mockIPC(
    (command, args) => {
      if (command === "plugin:window|is_maximized" || command === "plugin:window|is_fullscreen") {
        return false;
      }
      if (command === "plugin:window|minimize" || command === "plugin:window|close") {
        document.documentElement.dataset.lastWindowCommand = command;
        return;
      }
      if (view === "archive-shell" && command === "plugin:dialog|open") {
        return params.get("archiveParent");
      }
      if (view === "about-updates" || view === "library-updates") {
        if (command === "plugin:app|version") return APPLICATION_VERSION_FALLBACK;
        if (
          command === "open_external_url" &&
          typeof args === "object" &&
          args !== null &&
          "url" in args
        ) {
          if (view === "about-updates" && args.url === params.get("failExternalLink")) {
            throw new Error("Synthetic external opener failure");
          }
          document.documentElement.dataset.lastExternalUrl = String(args.url);
          return;
        }
      }
      throw new Error(`Unexpected ${view} fixture command: ${command}`);
    },
    { shouldMockEvents: true },
  );
}
createRoot(root).render(<BrowserFixture />);
