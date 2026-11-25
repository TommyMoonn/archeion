import { RotateCcw, X } from "lucide-react";

import { IconButton } from "../../../components/IconButton";
import { Button } from "../../../components/Button";
import { Kbd } from "../../../components/ui/kbd";
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
      <div className="flex min-w-0 max-w-full items-center justify-end gap-control-gap settings-row-narrow:w-full settings-row-narrow:flex-wrap settings-row-narrow:justify-start max-workspace-narrow:w-full">
        <div className="inline-flex min-w-0 max-w-full flex-initial items-center justify-end gap-settings-small-gap settings-row-narrow:w-full settings-row-narrow:flex-wrap settings-row-narrow:justify-start">
          <Button
            aria-label={`Change shortcut for ${label}`}
            className="min-w-0 max-w-full flex-initial bg-surface px-dialog-copy whitespace-normal control-hover:border-accent-border control-hover:bg-surface-raised control-hover:text-text focus-visible:border-accent-border focus-visible:bg-surface-raised"
            onClick={onChange}
            size="compact"
            tooltip={`Change shortcut for ${label}`}
            variant="secondary"
          >
            <Kbd variant="inline" className="wrap-anywhere whitespace-normal">
              {bindingLabel}
            </Kbd>
          </Button>
          {onClear ? (
            <IconButton
              className="shrink-0"
              label={`Clear shortcut for ${label}`}
              onClick={onClear}
              size="compact"
            >
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        {onReset ? (
          <IconButton label={`Reset ${label} to default`} onClick={onReset} size="compact">
            <RotateCcw aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
    </CompactSettingsRow>
  );
}
