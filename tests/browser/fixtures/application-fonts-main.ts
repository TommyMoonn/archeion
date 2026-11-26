import { collectionHeader } from "../../../src/components/collectionPresentation";
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

const header = document.querySelector(".library-header");
const title = header?.querySelector("h1");
const eyebrow = header?.querySelector(".eyebrow");
if (!header || !title || !eyebrow) throw new Error("Application font fixture header is missing.");
header.className = collectionHeader.root;
title.className = collectionHeader.title;
eyebrow.className = collectionHeader.eyebrow;

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
