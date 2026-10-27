import { Component, useContext, useLayoutEffect, type ReactNode } from "react";

import { Button } from "./Button";
import { DialogShellContext } from "./DialogShellContext";

function SurfaceLoadError({ onRetry }: { onRetry: () => void }) {
  const shell = useContext(DialogShellContext);
  useLayoutEffect(() => {
    shell?.reset();
  }, [shell]);
  if (shell) return shell.renderError(onRetry);
  return (
    <div className="async-surface-error dialog__body">
      <p role="alert">This content could not be opened.</p>
      <Button onClick={onRetry} variant="secondary">
        Try again
      </Button>
    </div>
  );
}

export class SurfaceErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void; renderError?: (retry: () => void) => ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      this.props.renderError ? (
        this.props.renderError(this.props.onRetry)
      ) : (
        <SurfaceLoadError onRetry={this.props.onRetry} />
      )
    ) : (
      this.props.children
    );
  }
}
