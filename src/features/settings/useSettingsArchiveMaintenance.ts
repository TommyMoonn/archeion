import { useEffect, useSyncExternalStore } from "react";

import {
  settingsArchiveMaintenanceClient,
  type SettingsArchiveMaintenance,
  type SettingsArchiveMaintenanceClient,
  type SettingsArchiveSnapshot,
} from "./settingsArchiveMaintenanceClient";

export type SettingsArchiveBoundary = Readonly<{
  maintenance: SettingsArchiveMaintenance | null;
  snapshot: SettingsArchiveSnapshot;
}>;

export function useSettingsArchiveMaintenance(
  client: SettingsArchiveMaintenanceClient = settingsArchiveMaintenanceClient,
): SettingsArchiveBoundary {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);

  useEffect(() => {
    void client.initialize().catch((error) => {
      console.error("Settings archive maintenance initialization failed", error);
    });
  }, [client]);

  return { maintenance: client.maintenance(), snapshot };
}
