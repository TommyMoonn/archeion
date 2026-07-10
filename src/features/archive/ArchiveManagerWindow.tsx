import { Component, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { archiveStore } from "../../stores/archiveStore";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";
import { completeArchiveManagerAction } from "./archiveManagerCompletion";
import { useArchive } from "./useArchive";

type ArchiveManagerErrorBoundaryProps = {
  children: ReactNode;
};

type ArchiveManagerErrorBoundaryState = {
  error: string | null;
};

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Archive Manager could not be initialized.";
}

export function ArchiveManagerFallback({ message }: { message: string }) {
  return (
    <main className="archive-manager-shell archive-manager-shell--standalone">
      <section
        className="archive-manager-window archive-manager-window--manager"
        aria-labelledby="archive-manager-fallback-title"
      >
        <div className="archive-manager-window__fallback" role="alert">
          <h1 id="archive-manager-fallback-title">Archive Manager</h1>
          <p>{message}</p>
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

  static getDerivedStateFromError(error: unknown): ArchiveManagerErrorBoundaryState {
    return { error: messageFromError(error) };
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

    void archiveStore.initialize().catch((error) => {
      if (!cancelled) {
        setInitializationError(messageFromError(error));
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
        standalone
        state={archive}
      />
    </ArchiveManagerErrorBoundary>
  );
}
