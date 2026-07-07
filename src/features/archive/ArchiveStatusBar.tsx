import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { ScanStatus } from "../../storage/LibraryStorage";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { useArchive } from "./useArchive";

export function ArchiveStatusBar() {
  const state = useArchive();
  const storage = useLibraryStorage();
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ status: "idle" });

  useEffect(() => {
    return storage.observeScanStatus({ next: setScanStatus });
  }, [storage]);

  if (state.status !== "ready") {
    return null;
  }

  if (state.watcherError) {
    return (
      <div className="import-notice import-notice--error" role="status">
        <WarningCircle aria-hidden="true" size={19} weight="regular" />
        <div>
          <p>{state.watcherError}</p>
        </div>
      </div>
    );
  }

  if (scanStatus.status !== "scanning") {
    return null;
  }

  return (
    <div className="import-notice" role="status" aria-live="polite">
      <ArrowsClockwise aria-hidden="true" size={18} weight="regular" />
      <div>
        <p>Scanning archive</p>
      </div>
    </div>
  );
}
