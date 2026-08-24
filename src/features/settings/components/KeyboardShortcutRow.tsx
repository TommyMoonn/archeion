import { RotateCcw, X } from "lucide-react";

import { IconButton } from "../../../components/IconButton";
import { CompactSettingsRow } from "./SettingsRows";

type KeyboardShortcutRowProps = {
  bindingLabel: string;
  label: string;
  onChange: () => void;
  onClear?: () => void;
  onReset?: () => void;
};

export function KeyboardShortcutRow({
  bindingLabel,
  label,
  onChange,
  onClear,
  onReset,
}: KeyboardShortcutRowProps) {
  return (
    <CompactSettingsRow label={label}>
      <div className="keyboard-shortcut-row__controls">
        <div className="keyboard-shortcut-binding-control">
          <button
            aria-label={`Change shortcut for ${label}`}
            className="keyboard-shortcut-binding"
            onClick={onChange}
            type="button"
          >
            <kbd>{bindingLabel}</kbd>
          </button>
          {onClear ? (
            <IconButton
              className="keyboard-shortcut-clear"
              label={`Clear shortcut for ${label}`}
              onClick={onClear}
              size="compact"
            >
              <X aria-hidden="true" strokeWidth={2.25} />
            </IconButton>
          ) : null}
        </div>
        {onReset ? (
          <IconButton
            className="keyboard-shortcut-reset"
            label={`Reset ${label} to default`}
            onClick={onReset}
            size="compact"
          >
            <RotateCcw aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </CompactSettingsRow>
  );
}
