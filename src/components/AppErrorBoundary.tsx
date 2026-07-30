import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./Button";
import { MAIN_CONTENT_ID } from "./SkipLink";

type AppErrorBoundaryProps = {
  children: ReactNode;
  mainContentId?: string;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Archeion recovered from an app error.", error, errorInfo);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const mainContentId = this.props.mainContentId ?? MAIN_CONTENT_ID;
      return (
        <main
          aria-atomic="true"
          aria-live="assertive"
          className="status-page"
          data-tone="error"
          id={mainContentId}
          tabIndex={-1}
        >
          <p className="status-page__code">Error</p>
          <h1>Archeion could not load this view</h1>
          <p>Reload the view. If it still fails, restart Archeion.</p>
          <Button onClick={this.retry} variant="secondary">
            Reload view
          </Button>
        </main>
      );
    }

    return this.props.children;
  }
}
