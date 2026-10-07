import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";

import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { SettingsSurface } from "../../../src/features/settings/SettingsSurface";
import { createInstalledFontCatalog } from "../../../src/storage/installedFontCatalog";
import { appPreferencesStore } from "../../../src/stores/appPreferencesStore";
import { AppearanceRuntime } from "../../../src/themes/AppearanceRuntime";
import type { AppPreferences } from "../../../src/types/appSettings";
import { largeFontCatalog } from "./font-catalog";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    applicationFontSettingsFixture: {
      readonly preferences: AppPreferences;
      readonly providerCalls: number;
      releaseCatalog: () => void;
      ready: boolean;
    };
  }
}

const parameters = new URLSearchParams(location.search);
// Settings also enumerates custom themes. Keep unrelated native I/O deterministic,
// while leaving browser preference persistence and the real theme runtime intact.
mockIPC((command) => {
  if (command === "list_theme_packages") return [];
  if (command === "refresh_theme_catalog" || command === "load_theme_catalog_revision") {
    return { revision: 0 };
  }
  throw new Error(`Unexpected application font Settings fixture command: ${command}`);
});
let providerCalls = 0;
let releaseCatalog = () => {};
const pending = parameters.has("pending")
  ? new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    })
  : Promise.resolve();
const catalog = createInstalledFontCatalog(async () => {
  providerCalls += 1;
  await pending;
  return parameters.has("large")
    ? largeFontCatalog
    : [
        "Zulu",
        "Georgia",
        "Arial",
        "Long family name with multilingual 日本語 Ελληνικά and extended unbroken characters ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      ];
});

window.applicationFontSettingsFixture = {
  get preferences() {
    return appPreferencesStore.getSnapshot();
  },
  get providerCalls() {
    return providerCalls;
  },
  releaseCatalog,
  ready: false,
};
await appPreferencesStore.initialize();
if (parameters.has("light")) {
  await appPreferencesStore.update({ appTheme: { kind: "builtin", id: "light" } });
}
if (parameters.has("compact")) await appPreferencesStore.update({ density: "compact" });
if (parameters.has("missing")) {
  await appPreferencesStore.update({
    appearance: {
      interfaceFont: { kind: "system", family: "Arial" },
      displayFont: { kind: "system", family: "Missing Display" },
    },
  });
}
const runtime = new AppearanceRuntime({
  globalPreferences: appPreferencesStore,
  fontCatalog: catalog,
});
runtime.start();
focusPresentationRuntime.start(document);
const root = document.getElementById("root");
if (!root) throw new Error("Application font Settings fixture root is missing.");
createRoot(root).render(<SettingsSurface fontCatalog={catalog} />);
window.applicationFontSettingsFixture.ready = true;
