import { Save } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SurfacePresence } from "../../components/SurfacePresence";
import { Kbd } from "../../components/ui/kbd";
import type { KeyboardBinding } from "../../types/keyboard";
import {
  effectiveKeyboardBinding,
  formatKeyboardBinding,
  keyboardBindingFromEvent,
  keyboardBindingsEqual,
  keyboardEventOwnershipError,
  setKeyboardShortcutOverride,
  validateKeyboardBinding,
  type CommandDefinition,
  type ConfigurableCommandId,
} from "../commands/commandBindings";
import { KeyboardShortcutRow as KeyboardShortcutRowView } from "./components/KeyboardShortcutRow";
import { CompactSettingsRow, SettingsActionRow } from "./components/SettingsRows";
import type { SettingsController } from "./useSettingsController";

export function KeyboardShortcutRow({
  command,
  context,
}: {
  command: CommandDefinition;
  context: SettingsController;
}) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const current = effectiveKeyboardBinding(command, context.preferences.keyboard);
  const override = context.preferences.keyboard.shortcuts[command.id];
  const differsFromDefault = Boolean(
    override &&
    ("disabled" in override || !keyboardBindingsEqual(override.binding, command.defaultBinding)),
  );
  const currentLabel = formatKeyboardBinding(current) ?? "Unassigned";

  async function persistOverride(binding: KeyboardBinding) {
    const keyboard = setKeyboardShortcutOverride(
      context.preferences.keyboard,
      command.id as ConfigurableCommandId,
      keyboardBindingsEqual(binding, command.defaultBinding) ? undefined : { binding },
    );
    return context.updateAppPreferences({ keyboard });
  }

  async function clearShortcut() {
    const keyboard = setKeyboardShortcutOverride(
      context.preferences.keyboard,
      command.id as ConfigurableCommandId,
      { disabled: true },
    );
    await context.updateAppPreferences({ keyboard });
  }

  async function resetShortcut() {
    const keyboard = setKeyboardShortcutOverride(
      context.preferences.keyboard,
      command.id as ConfigurableCommandId,
      undefined,
    );
    await context.updateAppPreferences({ keyboard });
  }

  return (
    <>
      <KeyboardShortcutRowView
        bindingLabel={currentLabel}
        label={command.label}
        onChange={() => setCaptureOpen(true)}
        onClear={current ? () => void clearShortcut() : undefined}
        onReset={differsFromDefault ? () => void resetShortcut() : undefined}
      />
      <SurfacePresence>
        {captureOpen ? (
          <KeyboardShortcutCaptureDialog
            command={command}
            context={context}
            onClose={() => setCaptureOpen(false)}
            onSave={persistOverride}
          />
        ) : null}
      </SurfacePresence>
    </>
  );
}

export function KeyboardShortcutDocumentationRow({
  bindings,
  label,
}: {
  bindings: readonly KeyboardBinding[];
  label: string;
}) {
  const control = (
    <div
      aria-label={`${label} keys`}
      className="flex min-w-0 max-w-full flex-wrap justify-end gap-control-gap-compact"
    >
      {bindings.map((binding, index) => (
        <Kbd
          className="settings-row-narrow:wrap-anywhere settings-row-narrow:whitespace-normal"
          key={`${formatKeyboardBinding(binding)}-${index}`}
        >
          {formatKeyboardBinding(binding)}
        </Kbd>
      ))}
    </div>
  );

  return <CompactSettingsRow label={label}>{control}</CompactSettingsRow>;
}

export function ResetKeyboardShortcutsRow({ context }: { context: SettingsController }) {
  const hasOverrides = Object.keys(context.preferences.keyboard.shortcuts).length > 0;
  return (
    <SettingsActionRow label="Restore default shortcuts">
      <Button
        disabled={!hasOverrides}
        onClick={() => void context.updateAppPreferences({ keyboard: { shortcuts: {} } })}
        variant="secondary"
      >
        Reset all
      </Button>
    </SettingsActionRow>
  );
}

function KeyboardShortcutCaptureDialog({
  command,
  context,
  onClose,
  onSave,
}: {
  command: CommandDefinition;
  context: SettingsController;
  onClose: () => void;
  onSave: (binding: KeyboardBinding) => Promise<boolean>;
}) {
  const [candidate, setCandidate] = useState<KeyboardBinding>();
  const [captureError, setCaptureError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const validationMessageId = useId();
  const validation = useMemo(
    () =>
      captureError
        ? { ok: false as const, reason: captureError }
        : candidate
          ? validateKeyboardBinding(command.id, candidate, context.preferences.keyboard)
          : undefined,
    [candidate, captureError, command.id, context.preferences.keyboard],
  );

  async function save() {
    if (!candidate || validation?.ok !== true || saving) return;
    setSaving(true);
    const saved = await onSave(candidate);
    if (saved) onClose();
    else setSaving(false);
  }

  return (
    <Dialog
      closeOnBackdropClick={false}
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            busy={saving}
            disabled={validation?.ok !== true}
            icon={<Save aria-hidden="true" />}
            onClick={() => void save()}
          >
            Save shortcut
          </Button>
        </>
      }
      onClose={onClose}
      title="Edit keybind"
    >
      <div
        aria-describedby={validation ? validationMessageId : undefined}
        aria-description="Press a shortcut while focused. Tab moves to the dialog actions. Escape cancels."
        aria-invalid={validation?.ok === false || undefined}
        aria-label="Shortcut capture"
        data-dialog-initial-focus
        className="group grid min-w-0 min-h-shortcut-capture cursor-pointer place-content-center gap-dialog-copy rounded-control border-standard border-solid border-line bg-surface p-dialog-gap text-center wrap-anywhere transition-colors duration-fast ease-standard not-focus:hover:border-line-strong not-focus:hover:bg-surface-hover focus:border-focus focus:bg-accent-soft"
        role="group"
        onKeyDown={(event) => {
          // Tab and Shift+Tab are navigation, never assignable shortcuts.
          if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            onClose();
            return;
          }

          const ownershipError = keyboardEventOwnershipError(event.nativeEvent);
          if (ownershipError) {
            setCandidate(undefined);
            setCaptureError(ownershipError);
            return;
          }

          const next = keyboardBindingFromEvent(event.nativeEvent);
          if (next) {
            setCaptureError(undefined);
            setCandidate(next);
          }
        }}
        tabIndex={0}
      >
        <strong className="min-w-0 text-text font-mono text-title-small wrap-anywhere">
          {candidate ? (
            formatKeyboardBinding(candidate)
          ) : (
            <>
              <span className="hidden group-focus:inline">Press a shortcut</span>
              <span className="group-focus:hidden">Click to capture</span>
            </>
          )}
        </strong>
        {validation?.ok === false ? (
          <p
            className="m-0 min-w-0 max-w-shortcut-feedback text-body-supporting text-danger wrap-anywhere"
            data-tone="error"
            id={validationMessageId}
            role="alert"
          >
            {validation.reason}
          </p>
        ) : null}
        {validation?.ok === true ? (
          <p
            className="m-0 min-w-0 max-w-shortcut-feedback text-body-supporting text-muted wrap-anywhere"
            id={validationMessageId}
            role="status"
          >
            Shortcut available.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
