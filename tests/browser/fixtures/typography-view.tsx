import { useState } from "react";
import { Copy } from "lucide-react";

import { AppSelect } from "../../../src/components/AppSelect";
import { Button } from "../../../src/components/Button";
import { Dialog } from "../../../src/components/Dialog";
import { ActionListButton } from "../../../src/components/MenuItem";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { LibraryToolbar } from "../../../src/features/library/LibraryToolbar";
import { AboutSurface } from "../../../src/features/about/AboutSurface";
import { StandardSettingsRow } from "../../../src/features/settings/components/SettingsRows";
import { SettingsSectionHeader } from "../../../src/features/settings/components/SettingsSectionHeader";
import { createDefaultLibraryFilters, type LibrarySort } from "../../../src/types/library";

const ignore = () => undefined;

export function TypographyFixture() {
  const [query, setQuery] = useState("history");
  const [sort, setSort] = useState<LibrarySort>("title");
  const [theme, setTheme] = useState("dark");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Personal archive");

  if (new URLSearchParams(location.search).get("surface") === "about") {
    return (
      <main className="about-window-shell">
        <AboutSurface />
      </main>
    );
  }

  return (
    <TooltipProvider>
      <main style={{ padding: 24 }}>
        <LibraryToolbar
          filters={createDefaultLibraryFilters()}
          filterOptions={{ series: [], subjects: [], languages: [], publishers: [] }}
          isImporting={false}
          isRescanning={false}
          onClearFilters={ignore}
          onClearSearch={() => setQuery("")}
          onFilterChange={ignore}
          onOpenAddEpub={ignore}
          onQueryChange={setQuery}
          onRescan={async () => undefined}
          onSortChange={setSort}
          onToggleSelectionMode={ignore}
          onViewChange={ignore}
          query={query}
          resultCount={12}
          selectionMode={false}
          sort={sort}
          title="Library"
          view="grid"
        />
        <section className="settings-section" style={{ marginBlock: 24 }}>
          <SettingsSectionHeader title="Preferences" description="Choose how Archeion appears." />
          <div className="settings-section__group">
            <h3>Appearance</h3>
            <StandardSettingsRow
              label="Application theme"
              description="Applies to application controls, not publication fonts."
            >
              <AppSelect
                ariaLabel="Application theme"
                label="Theme"
                onChange={setTheme}
                options={[
                  { label: "Dark", value: "dark" },
                  { label: "Light", value: "light" },
                ]}
                value={theme}
              />
            </StandardSettingsRow>
          </div>
        </section>
        <Button onClick={() => setOpen(true)} variant="secondary">
          Edit archive name
        </Button>
        {open ? (
          <Dialog
            title="Rename archive"
            description="Choose a name that is easy to recognize."
            onClose={() => setOpen(false)}
            footer={<Button onClick={() => setOpen(false)}>Save name</Button>}
          >
            <label className="form-field">
              <span>Archive name</span>
              <input value={name} onChange={(event) => setName(event.currentTarget.value)} />
            </label>
            <div className="menu-popover">
              <ActionListButton icon={<Copy aria-hidden="true" />} onClick={ignore}>
                Copy archive path
              </ActionListButton>
            </div>
          </Dialog>
        ) : null}
      </main>
    </TooltipProvider>
  );
}
