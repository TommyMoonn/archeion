import { createInstalledFontCatalog } from "../../../src/storage/installedFontCatalog";
import { AppPreferencesStore } from "../../../src/stores/appPreferencesStore";
import { AppearanceRuntime } from "../../../src/themes/AppearanceRuntime";
import type { AppPreferencesChanges } from "../../../src/types/appSettings";
import "../../../src/styles/index.css";

declare global {
  interface Window {
    applicationFontFixture: {
      update: (changes: AppPreferencesChanges) => Promise<void>;
      ready: boolean;
    };
  }
}

const store = new AppPreferencesStore();
const runtime = new AppearanceRuntime({
  globalPreferences: store,
  fontCatalog: createInstalledFontCatalog(async () => [
    "Arial",
    "Georgia",
    'Odd, "Name" \\ ; } body { color: red',
  ]),
});
runtime.start();
window.applicationFontFixture = {
  ready: false,
  async update(changes) {
    await store.update(changes);
  },
};
await store.initialize();
window.applicationFontFixture.ready = true;
