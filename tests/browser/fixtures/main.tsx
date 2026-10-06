import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { BrowserFixture } from "./views";
import { shellStressThemes } from "../../fixtures/themes/shellStressThemes";
import { resolveTheme } from "../../../src/themes/resolveTheme";
import { applyResolvedAppTheme } from "../../../src/themes/themeCssVariables";
import { validateThemeManifest } from "../../../src/themes/validateThemeManifest";
import "../../../src/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Browser fixture root is missing.");
const stressTheme = new URLSearchParams(window.location.search).get("themeStress");
if (stressTheme !== null) {
  if (stressTheme !== "equal" && stressTheme !== "distinct")
    throw new Error("Unknown shell stress theme.");
  const validation = validateThemeManifest(shellStressThemes[stressTheme]);
  if (!validation.ok) throw new Error("Shell stress theme must pass schema-v1 validation.");
  applyResolvedAppTheme(document.documentElement, resolveTheme(validation.manifest).app);
}
if (new URLSearchParams(window.location.search).get("view") === "archive-shell") {
  // Exercise the real titlebar with mock IPC, not native window operations.
  Object.defineProperty(globalThis, "isTauri", { value: true, configurable: true });
  mockWindows("archive-manager");
  mockIPC((command) => {
    if (command === "plugin:window|minimize" || command === "plugin:window|close") {
      document.documentElement.dataset.lastWindowCommand = command;
      return;
    }
    throw new Error(`Unexpected Archive Manager fixture command: ${command}`);
  });
}
createRoot(root).render(<BrowserFixture />);
