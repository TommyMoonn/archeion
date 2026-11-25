import { useState } from "react";
import { Heart } from "lucide-react";
import { MemoryRouter } from "react-router-dom";
import { AppErrorBoundary } from "../../../src/components/AppErrorBoundary";
import { BrandLogo } from "../../../src/components/BrandLogo";
import { Button } from "../../../src/components/Button";
import { EmptyState } from "../../../src/components/EmptyState";
import { NotFoundPage } from "../../../src/components/NotFoundPage";
import { TooltipProvider } from "../../../src/components/Tooltip";
import { Progress } from "../../../src/components/ui/progress";
import { LibraryFeedbackStack } from "../../../src/features/library/LibraryFeedbackStack";
import type { LibraryFeedbackToken } from "../../../src/features/library/libraryFeedback";
import { ReaderOpeningStatus } from "../../../src/features/reader/ReaderOpeningStatus";
import { SettingsStatus } from "../../../src/features/settings/SettingsStatus";

function FaultyView(): never {
  throw new Error("Fixture rendering failed");
}

export function FeedbackFixture() {
  const [mode, setMode] = useState<"empty" | "search" | "loading">("empty");
  const [tokens, setTokens] = useState<LibraryFeedbackToken[]>([
    { id: "success", title: "Import complete", tone: "success" },
    { id: "warning", title: "Some books skipped", tone: "warning", detail: "Already in archive" },
    { id: "error", title: "Import failed", tone: "error", detail: "Try again" },
  ]);
  const view = new URLSearchParams(location.search).get("view");
  if (view === "not-found")
    return (
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
  if (view === "error-boundary")
    return (
      <AppErrorBoundary>
        <FaultyView />
      </AppErrorBoundary>
    );
  if (view === "feedback") {
    return (
      <TooltipProvider>
        <div style={{ position: "relative", minHeight: "100dvh", padding: 16 }}>
          <LibraryFeedbackStack
            tokens={tokens}
            onDismiss={(id) => setTokens((current) => current.filter((token) => token.id !== id))}
          />
          <div
            style={{ position: "absolute", insetInline: 16, bottom: 120, display: "grid", gap: 12 }}
          >
            <Progress value={42} aria-label="Known download progress" />
            <Progress value={null} aria-label="Unknown download progress" />
          </div>
          <SettingsStatus persistenceStatus={{ status: "loading" }} status={null} />
        </div>
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider>
      <div style={{ padding: 16, minHeight: "100dvh" }}>
        <header className="about-window__brand" style={{ width: 64 }}>
          <BrandLogo />
        </header>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button onClick={() => setMode("empty")}>Empty</Button>
          <Button onClick={() => setMode("search")}>No matches</Button>
          <Button onClick={() => setMode("loading")}>Loading</Button>
        </div>
        <section
          aria-label="Collection state"
          style={{ display: "grid", placeItems: "center", minHeight: 260 }}
        >
          {mode === "loading" ? (
            <div className="reader-page" style={{ width: "100%", height: 240 }}>
              <ReaderOpeningStatus />
            </div>
          ) : (
            <EmptyState
              title={mode === "empty" ? "No favorites yet" : "No matching books"}
              description="Try another search or browse the library."
              icon={mode === "empty" ? <Heart /> : undefined}
              action={
                <Button variant="secondary" onClick={() => setMode("empty")}>
                  Browse Library
                </Button>
              }
            />
          )}
        </section>
      </div>
    </TooltipProvider>
  );
}
