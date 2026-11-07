import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../../src/components/Button";
import { Dialog } from "../../../src/components/Dialog";
import { SegmentedControl } from "../../../src/components/SegmentedControl";
import { SeriesDetail } from "../../../src/features/series/SeriesDetail";
import "../../../src/styles/index.css";

export function Gallery() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("grid");
  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>Shared controls</h1>
      {(["compact", "standard", "prominent"] as const).map((size) => (
        <div key={size} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
            <Button key={variant} size={size} variant={variant}>
              {size} {variant}
            </Button>
          ))}
        </div>
      ))}
      <SegmentedControl
        label="View"
        value={value}
        onChange={setValue}
        options={[
          { label: "Grid", value: "grid" },
          { label: "List", value: "list" },
        ]}
      />
      <SeriesDetail onBack={() => {}} onRead={() => {}} />
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      {open ? (
        <Dialog
          title="Shared dialog"
          onClose={() => setOpen(false)}
          footer={<Button onClick={() => setOpen(false)}>Close</Button>}
        >
          <p>Existing native modal and focus behavior.</p>
        </Dialog>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Gallery />);
