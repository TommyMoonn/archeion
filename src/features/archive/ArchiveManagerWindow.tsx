import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { initializeArchiveManagerStartup } from "../../app/startupController";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";
import { completeArchiveManagerAction } from "./archiveManagerCompletion";
import { useArchive } from "./useArchive";
import { ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";

type ArchiveManagerErrorBoundaryProps = {
  children: ReactNode;
};

type ArchiveManagerErrorBoundaryState = {
  error: string | null;
};

const ARCHIVE_MANAGER_OPEN_ERROR =
  "Archive Manager could not open. Close this window and open Archive Manager again.";

export function ArchiveManagerFallback({ message }: { message: string }) {
  return (
    <main className="archive-manager-shell" id={ARCHIVE_MANAGER_MAIN_CONTENT_ID} tabIndex={-1}>
      <section
        className="archive-manager-window archive-manager-window--manager"
        aria-labelledby="archive-manager-fallback-title"
      >
        <div className="archive-manager-window__body">
          <aside
            aria-hidden="true"
            className="archive-manager-window__sidebar archive-manager-window__sidebar--fallback"
          />
          <section className="archive-manager-window__main">
            <div className="archive-manager-window__fallback" data-tone="error" role="alert">
              <h1 id="archive-manager-fallback-title">Archive Manager</h1>
              <p>{message}</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

class ArchiveManagerErrorBoundary extends Component<
  ArchiveManagerErrorBoundaryProps,
  ArchiveManagerErrorBoundaryState
> {
  state: ArchiveManagerErrorBoundaryState = { error: null };

  static getDerivedStateFromError(): ArchiveManagerErrorBoundaryState {
    return { error: ARCHIVE_MANAGER_OPEN_ERROR };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Archive Manager render failed", error, errorInfo);
    }
  }

  render() {
    if (this.state.error) {
      return <ArchiveManagerFallback message={this.state.error} />;
    }

    return this.props.children;
  }
}

export function ArchiveManagerWindow() {
  const archive = useArchive();
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void initializeArchiveManagerStartup().catch((error) => {
      if (!cancelled) {
        setInitializationError(ARCHIVE_MANAGER_OPEN_ERROR);
      }
      console.error("Archive Manager initialization failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (initializationError) {
    return <ArchiveManagerFallback message={initializationError} />;
  }

  return (
    <ArchiveManagerErrorBoundary>
      <ArchiveManagerWindowContent
        onArchiveChoiceComplete={completeArchiveManagerAction}
        state={archive}
      />
    </ArchiveManagerErrorBoundary>
  );
}
