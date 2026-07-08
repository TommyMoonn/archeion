import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";

type SettingsStatusProps = {
  persistenceStatus: AppPreferencesPersistenceStatus;
  status: string | null;
};

function statusMessage(status: AppPreferencesPersistenceStatus) {
  if (status.status === "saving") return "Saving settings.";
  if (status.status === "saved") return "Settings saved.";
  if (status.status === "loading") return "Loading settings.";
  if (status.status === "error") return status.error;
  return null;
}

export function SettingsStatus({
  persistenceStatus,
  status,
}: SettingsStatusProps) {
  if (!status && persistenceStatus.status === "idle") {
    return null;
  }

  return (
    <p
      className="settings-status"
      data-error={persistenceStatus.status === "error" || undefined}
      role={persistenceStatus.status === "error" ? "alert" : "status"}
    >
      {status ?? statusMessage(persistenceStatus)}
    </p>
  );
}
