import { useSyncExternalStore } from "react";
import { Button } from "../components/Button";
import { appearanceRuntime } from "../themes/appearanceRuntimeInstance";

export function AppearanceStatus() {
  const { error } = useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getStartupSnapshot,
    appearanceRuntime.getStartupSnapshot,
  );
  return (
    <div
      className={error ? "appearance-status appearance-status--visible" : "appearance-status"}
      role="status"
    >
      {error && (
        <div className="appearance-status__notice">
          <p>{error}</p>
          <Button onClick={appearanceRuntime.dismissStartupError}>Dismiss theme notice</Button>
        </div>
      )}
    </div>
  );
}
