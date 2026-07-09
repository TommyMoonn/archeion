import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./Button";

type AppErrorBoundaryProps = {
  children: ReactNode;
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
      return (
        <main className="status-page" role="alert">
          <p className="status-page__code">Error</p>
          <h1>Something went wrong</h1>
          <p>Restart Archeion or try loading this view again.</p>
          <Button onClick={this.retry} variant="secondary">
            Try again
          </Button>
        </main>
      );
    }

    return this.props.children;
  }
}
