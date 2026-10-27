import { useState } from "react";
import { Button } from "../../../src/components/Button";

export function BusyActionsFixture() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("Ready");
  const [calls, setCalls] = useState(0);
  return (
    <main style={{ padding: 24 }}>
      <button
        onClick={() => {
          setBusy(true);
          setOutcome("Working…");
        }}
        type="button"
      >
        Start work
      </button>
      <button
        onClick={() => {
          setBusy(false);
          setOutcome("Succeeded");
        }}
        type="button"
      >
        Succeed
      </button>
      <button
        onClick={() => {
          setBusy(false);
          setOutcome("Failed. Try again.");
        }}
        type="button"
      >
        Fail
      </button>
      <p role="status">{outcome}</p>
      <output aria-label="Activations">{calls}</output>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {(["primary", "secondary", "danger", "ghost"] as const).flatMap((variant) =>
          (["compact", "standard", "prominent"] as const).flatMap((size) =>
            ["Move", "Write metadata to EPUB"].map((label) => (
              <Button
                key={`${variant}-${size}-${label}`}
                busy={busy}
                variant={variant}
                size={size}
                onClick={() => setCalls((value) => value + 1)}
              >
                {label}
              </Button>
            )),
          ),
        )}
      </div>
    </main>
  );
}
