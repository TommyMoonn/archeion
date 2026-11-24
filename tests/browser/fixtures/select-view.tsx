import { useState } from "react";
import { AppSelect } from "../../../src/components/AppSelect";
import { Dialog } from "../../../src/components/Dialog";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { LibraryFilterPopover } from "../../../src/features/library/LibraryFilterPopover";
import { createDefaultLibraryFilters } from "../../../src/types/library";
import { ChevronDown } from "lucide-react";

const options = [
  { value: "", label: "Any" },
  { value: "disabled", label: "No more options", disabled: true },
  ...Array.from({ length: 12 }, (_, i) => ({ value: `option-${i}`, label: `Option ${i + 1}` })),
  {
    value: "long",
    label: "A substantially longer option label that must wrap within the available viewport width",
  },
];

export function SelectFixture() {
  const [filters, setFilters] = useState(createDefaultLibraryFilters);
  const [value, setValue] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const [disabled, setDisabled] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [scaled, setScaled] = useState(false);
  const select = (ariaLabel: string) => (
    <AppSelect
      ariaLabel={ariaLabel}
      disabled={disabled}
      onChange={setValue}
      onOpen={() => setOpenCount((count) => count + 1)}
      options={options}
      value={value}
    />
  );
  return (
    <TooltipProvider>
      <main style={{ padding: 24 }}>
        <button type="button" onClick={() => setDialog(true)}>
          Open dialog
        </button>
        <button type="button" onClick={() => setDisabled((current) => !current)}>
          Toggle disabled
        </button>
        <button type="button" onClick={() => setScaled((current) => !current)}>
          Toggle scale
        </button>
        <output aria-label="Open count">{openCount}</output>
        <output aria-label="Selected value">{value || "Any"}</output>
        <div
          className="reader-page"
          data-reader-theme="sepia"
          style={{
            position: "absolute",
            bottom: 24,
            right: 24,
            width: 220,
            height: "auto",
            minHeight: 0,
            overflow: "visible",
            transform: scaled ? "scale(0.8)" : undefined,
            transformOrigin: "bottom right",
          }}
        >
          <div className="reader-settings" style={{ backdropFilter: "blur(10px)" }}>
            {select("Reader choice")}
          </div>
        </div>
        <div style={{ width: 200, marginTop: 20 }}>{select("Sort choice")}</div>
        <AppSelect
          appearance="icon-only"
          ariaLabel="Icon choice"
          onChange={setValue}
          options={options}
          size="compact"
          triggerIcon={<ChevronDown />}
          value={value}
        />
        <button type="button">After select</button>
        <LibraryFilterPopover
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters(createDefaultLibraryFilters())}
          options={{
            series: ["First series", "Second series"],
            subjects: [],
            languages: [],
            publishers: [],
          }}
        />
        {dialog ? (
          <Dialog title="Select dialog" onClose={() => setDialog(false)}>
            {select("Dialog choice")}
          </Dialog>
        ) : null}
      </main>
    </TooltipProvider>
  );
}
