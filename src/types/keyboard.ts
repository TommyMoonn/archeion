export type KeyboardPlatform = "mac" | "windows-linux";

export type KeyboardBinding = {
  alt: boolean;
  key: string;
  primary: boolean;
  shift: boolean;
};

export type KeyboardShortcutOverride = { binding: KeyboardBinding } | { disabled: true };

export type KeyboardPreferences = {
  shortcuts: Record<string, KeyboardShortcutOverride>;
};
