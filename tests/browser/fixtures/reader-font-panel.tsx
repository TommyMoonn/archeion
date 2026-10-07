import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ReaderSettingsPanel } from "../../../src/features/reader/ReaderSettingsPanel";
import { ReaderSideSurfaceLayer } from "../../../src/features/reader/ReaderSideSurfaceLayer";
import type { ReaderAppearanceController } from "../../../src/features/reader/readerAppearanceController";
import type { InstalledFontCatalog } from "../../../src/storage/installedFontCatalog";
import { readerThemeCssProperties } from "../../../src/themes/themeCssVariables";

export function mountReaderFontPanel(
  controller: ReaderAppearanceController,
  fontCatalog: InstalledFontCatalog,
) {
  const host = document.querySelector("main")!.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const trigger = document.getElementById("reader-chrome")!;
  function Panel() {
    const [open, setOpen] = useState(false);
    const appearance = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    useEffect(() => {
      const open = () => setOpen(true);
      trigger.addEventListener("click", open);
      trigger.dataset.panelReady = "true";
      return () => trigger.removeEventListener("click", open);
    }, []);
    useEffect(() => {
      const main = document.querySelector("main")!;
      main.dataset.readerTheme = appearance.readerTheme.base;
      for (const [property, value] of Object.entries(
        readerThemeCssProperties(appearance.readerTheme),
      )) {
        main.style.setProperty(property, String(value));
      }
    }, [appearance.readerTheme]);
    return (
      <>
        {open ? (
          <ReaderSideSurfaceLayer onDismiss={() => setOpen(false)}>
            <ReaderSettingsPanel
              fontCatalog={fontCatalog}
              layoutCapability="reflowable"
              onClose={() => setOpen(false)}
              onReaderThemeCommit={(selection) => void controller.commitReaderTheme(selection)}
              onReaderThemeOpen={() => undefined}
              onSettingsCommit={(settings) => void controller.commitSettings(settings)}
              persistenceFailed={appearance.persistenceFailed}
              readerThemeCatalogError={null}
              readerThemeEntries={[]}
              readerThemeSelection={appearance.readerThemeSelection}
              settings={appearance.settings}
            />
          </ReaderSideSurfaceLayer>
        ) : null}
      </>
    );
  }
  root.render(<Panel />);
}
