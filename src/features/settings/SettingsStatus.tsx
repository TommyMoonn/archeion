import { useEffect, useState } from "react";

import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";

export type SettingsStatusTone = "neutral" | "success" | "error";

export type SettingsLocalStatus = {
  message: string;
  tone: SettingsStatusTone;
};

export const PERSISTENCE_SAVING_STATUS_DELAY_MS = 500;

type SettingsStatusProps = {
  persistenceStatus: AppPreferencesPersistenceStatus;
  status: SettingsLocalStatus | null;
};

type StatusMessageProps = {
  message: string;
  tone: SettingsStatusTone;
};

function StatusMessage({ message, tone }: StatusMessageProps) {
  return (
    <p
      className="settings-status status-token"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

function DelayedSavingStatus() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, PERSISTENCE_SAVING_STATUS_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  return <StatusMessage message="Saving settings." tone="neutral" />;
}

export function SettingsStatus({ persistenceStatus, status }: SettingsStatusProps) {
  if (status) {
    return <StatusMessage message={status.message} tone={status.tone} />;
  }

  if (persistenceStatus.status === "saving") {
    return <DelayedSavingStatus />;
  }

  if (persistenceStatus.status === "loading") {
    return <StatusMessage message="Loading settings." tone="neutral" />;
  }

  if (persistenceStatus.status === "error") {
    return <StatusMessage message={persistenceStatus.error} tone="error" />;
  }

  return null;
}
