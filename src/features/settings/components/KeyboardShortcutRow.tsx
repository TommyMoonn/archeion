import { RotateCcw, X } from "lucide-react";

import { IconButton } from "../../../components/IconButton";
import { Tooltip } from "../../../components/Tooltip";
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
          <Tooltip content={`Change shortcut for ${label}`}>
            <button
              aria-label={`Change shortcut for ${label}`}
              className="keyboard-shortcut-binding"
              onClick={onChange}
              type="button"
            >
              <kbd>{bindingLabel}</kbd>
            </button>
          </Tooltip>
          {onClear ? (
            <IconButton
              className="keyboard-shortcut-clear"
              label={`Clear shortcut for ${label}`}
              onClick={onClear}
              size="compact"
            >
              <X aria-hidden="true" />
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
