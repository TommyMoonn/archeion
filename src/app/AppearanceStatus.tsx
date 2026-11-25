import { appearanceNoticeClass } from "../components/statusStyles";
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
      className={error ? `appearance-status ${appearanceNoticeClass}` : "appearance-status"}
      role="status"
    >
      {error && (
        <div className="appearance-status__notice">
          <p className="mt-0 mb-3">{error}</p>
          <Button onClick={appearanceRuntime.dismissStartupError}>Dismiss theme notice</Button>
        </div>
      )}
    </div>
  );
}
