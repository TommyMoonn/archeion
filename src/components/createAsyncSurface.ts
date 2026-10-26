import { createElement, lazy, useState, type ComponentType, type ReactNode } from "react";
import { SurfaceErrorBoundary } from "./AsyncSurfaceBoundary";

/** Import on intent, retain successful chunks and replace a rejected lazy identity on retry. */
export function createAsyncSurface<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  renderError?: (props: Props, retry: () => void) => ReactNode,
) {
  let current = lazy(load);
  return function AsyncSurface(props: Props) {
    const [attempt, setAttempt] = useState(() => ({ Content: current, version: 0 }));
    return createElement(SurfaceErrorBoundary, {
      key: attempt.version,
      renderError: renderError ? (retry) => renderError(props, retry) : undefined,
      onRetry: () => {
        current = lazy(load);
        setAttempt(({ version }) => ({ Content: current, version: version + 1 }));
      },
      children: createElement(attempt.Content, props),
    });
  };
}
