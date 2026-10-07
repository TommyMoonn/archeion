import { useEffect, useState } from "react";

import { Dialog } from "../../../src/components/Dialog";
import { FontPicker, type FontPickerSelection } from "../../../src/components/FontPicker";
import { StandardSettingsRow } from "../../../src/features/settings/components/SettingsRows";
import { createInstalledFontCatalog } from "../../../src/storage/installedFontCatalog";

const families = Object.freeze([
  "Alpha Serif",
  "Beta Sans",
  ...Array.from({ length: 500 }, (_, index) => `Catalog Family ${String(index).padStart(3, "0")}`),
  "Long family name with multilingual 日本語 Ελληνικά and extended unbroken characters ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "Zulu",
]);
const pinnedOptions = [
  { value: "default", label: "Default choice" },
  { value: "inherit", label: "Follow another choice" },
];

export function FontPickerFixture() {
  const params = new URLSearchParams(location.search);
  const [providerCalls, setProviderCalls] = useState(0);
  const [catalog] = useState(() =>
    createInstalledFontCatalog(async () => {
      setProviderCalls((count) => count + 1);
      return params.has("empty") ? [] : families;
    }),
  );
  const [installedFamilies, setInstalledFamilies] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let current = true;
    // Independent consumers share the same session result, not another enumeration.
    void Promise.all([catalog.load(), catalog.load()]).then(([result]) => {
      if (!current) return;
      setInstalledFamilies(result);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [catalog]);
  const [selection, setSelection] = useState<FontPickerSelection>(
    params.has("missing")
      ? { kind: "system", family: "Missing Family" }
      : { kind: "pinned", value: "default" },
  );
  const [secondary, setSecondary] = useState<FontPickerSelection>({
    kind: "pinned",
    value: "inherit",
  });
  const [selectionCount, setSelectionCount] = useState(0);
  const content = (
    <section className="settings-section" style={{ inlineSize: "min(520px, 100%)" }}>
      <h1>Font picker fixture</h1>
      <div className="settings-section__group">
        <StandardSettingsRow
          label="Family"
          description="Standalone picker; no preference persistence."
        >
          <FontPicker
            ariaLabel="Family"
            disabled={!loaded}
            installedFamilies={installedFamilies}
            onChange={(value) => {
              setSelection(value);
              setSelectionCount((count) => count + 1);
            }}
            pinnedOptions={pinnedOptions}
            value={selection}
          />
        </StandardSettingsRow>
        <StandardSettingsRow label="Secondary family">
          <FontPicker
            ariaLabel="Secondary family"
            disabled={!loaded}
            installedFamilies={installedFamilies}
            onChange={setSecondary}
            pinnedOptions={pinnedOptions}
            size="compact"
            value={secondary}
          />
        </StandardSettingsRow>
      </div>
      <p>
        Provider calls: <output data-testid="provider-calls">{providerCalls}</output>
      </p>
      <p>
        Selections: <output data-testid="selection-count">{selectionCount}</output>
      </p>
      <button style={{ position: "fixed", insetBlockEnd: 24, insetInlineStart: 24 }} type="button">
        After picker
      </button>
    </section>
  );
  return (
    <main
      style={{
        padding: 24,
        paddingBlockStart: params.has("bottom") ? "calc(100vh - 160px)" : 24,
        ...(params.has("transform")
          ? {
              transform: "translate(12px, 8px) scale(0.85)",
              transformOrigin: "top left",
              backdropFilter: "blur(2px)",
            }
          : {}),
      }}
    >
      {params.has("modal") ? (
        <Dialog title="Picker dialog" onClose={() => {}}>
          {content}
        </Dialog>
      ) : (
        content
      )}
    </main>
  );
}
