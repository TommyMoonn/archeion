import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "../../../src/components/Button";
import { IconButton } from "../../../src/components/IconButton";
import { Input } from "../../../src/components/Input";

export function BusyActionsFixture() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("Ready");
  const [calls, setCalls] = useState(0);
  const [submitted, setSubmitted] = useState("");
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
      <form
        aria-label="Shared control form"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(String(new FormData(event.currentTarget).get("query")));
        }}
      >
        <Input label="Query" name="query" icon={<Search />} required size="standard" />
        <Input label="Invalid query" aria-invalid="true" />
        <IconButton label="Search options" size="compact" disabled disabledReason="Unavailable">
          <Search />
        </IconButton>
        <Button type="submit" size="standard">
          Submit query
        </Button>
        <output aria-label="Submitted query">{submitted}</output>
      </form>
    </main>
  );
}
