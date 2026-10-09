import { useEffect, useRef, useState } from "react";
import { usePausableAutoDismiss } from "../../components/usePausableAutoDismiss";
import type { AppUpdateClient } from "./appUpdateClient";
import type { AppUpdateSnapshot } from "./appUpdateTypes";

/** View-local lifetime only. Native completion metadata is the admission/persistence owner. */
export function useCompletedUpdateNotice(
  client: AppUpdateClient,
  update: AppUpdateSnapshot | null,
  suppressed: boolean,
) {
  const [notice, setNotice] = useState<{ version: string; dismissed: boolean } | null>(null);
  const attemptedVersion = useRef<string | null>(null);
  const completed =
    update?.supported && update.prompt.completedVersion === update.currentVersion
      ? update.prompt.completedVersion
      : null;
  // Capture before native acknowledgement clears the marker. This retains the visible
  // confirmation for its eight-second lifetime without retaining native completion state.
  if (
    !suppressed &&
    completed &&
    completed !== notice?.version &&
    !client.hasPendingCompletionAcknowledgement(completed)
  )
    setNotice({ version: completed, dismissed: false });
  if (suppressed && notice && !notice.dismissed) setNotice({ ...notice, dismissed: true });
  const version =
    !suppressed &&
    notice &&
    !notice.dismissed &&
    update?.supported &&
    notice.version === update.currentVersion
      ? notice.version
      : null;
  useEffect(() => {
    if (!version || attemptedVersion.current === version) return;
    attemptedVersion.current = version;
    void client
      .acknowledgeCompleted(version)
      .catch((error) => console.error("Completed update acknowledgement failed", error));
  }, [client, version]);
  const pauseHandlers = usePausableAutoDismiss<HTMLElement>({
    durationMs: 8000,
    enabled: version !== null,
    resetKey: version,
    onDismiss: () => setNotice((current) => (current ? { ...current, dismissed: true } : null)),
  });
  return { version, pauseHandlers };
}
