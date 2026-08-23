import { useRef } from "react";

import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import type { FocusReturnRecord } from "../../utils/focusRestoration";
import { SettingsSurface } from "./SettingsSurface";
import type { SettingsSection } from "./settingsSections";

type SettingsDialogProps = {
  focusReturn?: FocusReturnRecord;
  initialSection?: SettingsSection;
  onClose: () => void;
};

export function SettingsDialog({
  focusReturn,
  initialSection = "general",
  onClose,
}: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialogLifecycle({
    dialogRef,
    focusReturn,
    initialFocusRef: closeButtonRef,
    onClose,
    surfaceKind: "settings",
  });

  return (
    <dialog
      aria-labelledby="settings-title"
      aria-modal="true"
      className="settings-dialog"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <SettingsSurface
        archiveAccess="required"
        closeButtonRef={closeButtonRef}
        initialSection={initialSection}
        onClose={onClose}
      />
    </dialog>
  );
}
