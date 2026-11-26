import { createRoot } from "react-dom/client";

import { IntegrityFixture } from "./integrity-view";
import { shellStressThemes } from "../../fixtures/themes/shellStressThemes";
import { resolveAppTheme, resolveTheme } from "../../../src/themes/resolveTheme";
import { applyResolvedAppTheme } from "../../../src/themes/themeCssVariables";
import { validateThemeManifest } from "../../../src/themes/validateThemeManifest";
import "../../../src/styles/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Browser fixture root is missing.");
const stressTheme = new URLSearchParams(window.location.search).get("themeStress");
if (new URLSearchParams(window.location.search).has("light")) {
  applyResolvedAppTheme(document.documentElement, resolveAppTheme("light", {}));
}
if (stressTheme !== null) {
  if (stressTheme !== "equal" && stressTheme !== "distinct")
    throw new Error("Unknown shell stress theme.");
  const validation = validateThemeManifest(shellStressThemes[stressTheme]);
  if (!validation.ok) throw new Error("Shell stress theme must pass schema-v1 validation.");
  applyResolvedAppTheme(document.documentElement, resolveTheme(validation.manifest).app);
}
createRoot(root).render(<IntegrityFixture />);
