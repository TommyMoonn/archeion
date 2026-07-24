import { ArrowCounterClockwise, X } from "@phosphor-icons/react";
import { useId, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
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
import { SettingsRow } from "./SettingsRow";
import type { SettingsDialogController } from "./useSettingsDialogController";

export function KeyboardShortcutRow({
  command,
  context,
}: {
  command: CommandDefinition;
  context: SettingsDialogController;
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
      <SettingsRow label={command.label}>
        <div className="keyboard-shortcut-row__controls">
          <div className="keyboard-shortcut-binding-control">
            <button
              aria-label={`Change shortcut for ${command.label}`}
              className="keyboard-shortcut-binding"
              onClick={() => setCaptureOpen(true)}
              type="button"
            >
              <kbd>{currentLabel}</kbd>
            </button>
            {current ? (
              <IconButton
                className="keyboard-shortcut-clear"
                label={`Clear shortcut for ${command.label}`}
                onClick={() => void clearShortcut()}
                size="compact"
              >
                <X aria-hidden="true" weight="bold" />
              </IconButton>
            ) : null}
          </div>
          {differsFromDefault ? (
            <IconButton
              className="keyboard-shortcut-reset"
              label={`Reset ${command.label} to default`}
              onClick={() => void resetShortcut()}
              size="compact"
            >
              <ArrowCounterClockwise aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </SettingsRow>
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
  description,
  label,
}: {
  bindings: readonly KeyboardBinding[];
  description?: string;
  label: string;
}) {
  return (
    <SettingsRow description={description} label={label}>
      <div aria-label={`${label} keys`} className="keyboard-shortcut-keycaps">
        {bindings.map((binding, index) => (
          <kbd key={`${formatKeyboardBinding(binding)}-${index}`}>
            {formatKeyboardBinding(binding)}
          </kbd>
        ))}
      </div>
    </SettingsRow>
  );
}

export function ResetKeyboardShortcutsRow({ context }: { context: SettingsDialogController }) {
  const hasOverrides = Object.keys(context.preferences.keyboard.shortcuts).length > 0;
  return (
    <SettingsRow label="Restore default shortcuts">
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
    </SettingsRow>
  );
}

function KeyboardShortcutCaptureDialog({
  command,
  context,
  onClose,
  onSave,
}: {
  command: CommandDefinition;
  context: SettingsDialogController;
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
