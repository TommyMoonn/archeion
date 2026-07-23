import { useEffect, useState } from "react";

import { usePausableAutoDismiss } from "../../components/usePausableAutoDismiss";
import type { AppPreferencesPersistenceStatus } from "../../stores/appPreferencesStore";

export type SettingsStatusTone = "neutral" | "success" | "error";

export type SettingsLocalStatus = {
  autoDismiss?: boolean;
  message: string;
  tone: SettingsStatusTone;
};

export const PERSISTENCE_SAVING_STATUS_DELAY_MS = 500;
export const SETTINGS_STATUS_AUTO_DISMISS_MS = 2_500;

type SettingsStatusProps = {
  onDismiss?: () => void;
  persistenceStatus: AppPreferencesPersistenceStatus;
  status: SettingsLocalStatus | null;
};

type StatusMessageProps = {
  autoDismiss?: boolean;
  message: string;
  onDismiss?: () => void;
  resetKey?: unknown;
  tone: SettingsStatusTone;
};

function StatusMessage({
  autoDismiss = false,
  message,
  onDismiss,
  resetKey = message,
  tone,
}: StatusMessageProps) {
  const pauseHandlers = usePausableAutoDismiss<HTMLParagraphElement>({
    durationMs: SETTINGS_STATUS_AUTO_DISMISS_MS,
    enabled: autoDismiss && Boolean(onDismiss),
    onDismiss: () => onDismiss?.(),
    resetKey,
  });

  return (
    <p
      className="settings-status status-token"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      tabIndex={autoDismiss && Boolean(onDismiss) ? 0 : undefined}
      {...pauseHandlers}
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

export function SettingsStatus({ onDismiss, persistenceStatus, status }: SettingsStatusProps) {
  if (status) {
    return (
      <StatusMessage
        autoDismiss={status.autoDismiss}
        message={status.message}
        onDismiss={onDismiss}
        resetKey={status}
        tone={status.tone}
      />
    );
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
