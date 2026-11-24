import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Grid, List } from "lucide-react";
import { focusPresentationRuntime } from "../../../src/app/inputModality";
import { Toggle } from "../../../src/components/Toggle";
import { SegmentedControl } from "../../../src/components/SegmentedControl";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { SettingsSliderRow } from "../../../src/features/settings/components/SettingsRows";
import "../../../src/styles/index.css";

export function PreferenceControls() {
  const [enabled, setEnabled] = useState(false);
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState("grid");
  const [fontSize, setFontSize] = useState(16);
  const [changes, setChanges] = useState(0);
  return (
    <TooltipProvider>
      <main style={{ display: "grid", justifyItems: "start", gap: 20, padding: 24 }}>
        <Toggle checked={enabled} label="Watch archive" onChange={setEnabled} />
        <Toggle checked={compact} label="Compact switch" onChange={setCompact} size="compact" />
        <Toggle
          checked={false}
          disabled
          disabledReason="Archive is offline"
          label="Automatic scan"
          onChange={() => setChanges((count) => count + 1)}
        />
        <Toggle
          checked={false}
          disabled
          label="Unavailable"
          onChange={() => setChanges((count) => count + 1)}
        />
        <output aria-label="Unexpected changes">{changes}</output>
        <SegmentedControl
          appearance="icon-only"
          label="Collection view"
          onChange={setView}
          options={[
            { icon: <Grid />, label: "Grid", value: "grid" },
            { disabled: true, label: "Cards", value: "cards" },
            { icon: <List />, label: "List", value: "list" },
          ]}
          value={view}
        />
        <SettingsSliderRow
          description="Default reader text size"
          label="Font size"
          min={14}
          max={28}
          value={fontSize}
          onChange={setFontSize}
          suffix="px"
        />
      </main>
    </TooltipProvider>
  );
}

focusPresentationRuntime.start(document);
createRoot(document.getElementById("root")!).render(<PreferenceControls />);
