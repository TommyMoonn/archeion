import { useId, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
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
    return context.updateAppPreferences(
      { keyboard },
      { successMessage: `${command.label} shortcut updated.` },
    );
  }

  async function clearShortcut() {
    const keyboard = setKeyboardShortcutOverride(
      context.preferences.keyboard,
      command.id as ConfigurableCommandId,
      { disabled: true },
    );
    await context.updateAppPreferences(
      { keyboard },
      { successMessage: `${command.label} shortcut cleared.` },
    );
  }

  async function resetShortcut() {
    const keyboard = setKeyboardShortcutOverride(
      context.preferences.keyboard,
      command.id as ConfigurableCommandId,
      undefined,
    );
    await context.updateAppPreferences(
      { keyboard },
      { successMessage: `${command.label} shortcut reset.` },
    );
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
      {captureOpen ? (
        <KeyboardShortcutCaptureDialog
          command={command}
          context={context}
          onClose={() => setCaptureOpen(false)}
          onSave={persistOverride}
        />
      ) : null}
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
    <div aria-label={`${label} keys`} className="keyboard-shortcut-keycaps">
      {bindings.map((binding, index) => (
        <kbd key={`${formatKeyboardBinding(binding)}-${index}`}>
          {formatKeyboardBinding(binding)}
        </kbd>
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
        onClick={() =>
          void context.updateAppPreferences(
            { keyboard: { shortcuts: {} } },
            { successMessage: "Keyboard shortcuts reset." },
          )
        }
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
      className="keyboard-shortcut-capture-dialog"
      closeOnBackdropClick={false}
      description="Press one shortcut. Escape cancels without changing the current binding."
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button busy={saving} disabled={validation?.ok !== true} onClick={() => void save()}>
            Save shortcut
          </Button>
        </>
      }
      onClose={onClose}
      title={`Change ${command.label}`}
    >
      <div
        aria-describedby={validation ? validationMessageId : undefined}
        aria-invalid={validation?.ok === false || undefined}
        autoFocus
        className="keyboard-shortcut-capture"
        onKeyDown={(event) => {
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
        <strong>{candidate ? formatKeyboardBinding(candidate) : "Press a shortcut"}</strong>
        {validation?.ok === false ? (
          <p data-tone="error" id={validationMessageId} role="alert">
            {validation.reason}
          </p>
        ) : null}
        {validation?.ok === true ? (
          <p id={validationMessageId} role="status">
            Shortcut available.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
