export type CommandScope =
  "global" | "library" | "folders" | "settings" | "reader" | "transient-surface";

export type {
  KeyboardBinding,
  KeyboardPlatform,
  KeyboardPreferences,
  KeyboardShortcutOverride,
} from "../../types/keyboard";
import type {
  KeyboardBinding,
  KeyboardPlatform,
  KeyboardPreferences,
  KeyboardShortcutOverride,
} from "../../types/keyboard";

export type CommandConfigurationPolicy = "configurable" | "fixed" | "unbound";
export type CommandRepeatPolicy = "allow" | "ignore";

export type CommandDefinition = {
  configuration: CommandConfigurationPolicy;
  defaultBinding?: KeyboardBinding;
  group: "General" | "Library and Folders" | "Reader" | "Fixed Interaction Keys";
  id: string;
  label: string;
  repeatPolicy?: CommandRepeatPolicy;
  showInPalette?: boolean;
  scopes: readonly CommandScope[];
  visibleControlOwner?: string;
};

const binding = (
  key: string,
  modifiers: Partial<Omit<KeyboardBinding, "key">> = {},
): KeyboardBinding => ({
  alt: modifiers.alt ?? false,
  key: normalizeBindingKey(key),
  primary: modifiers.primary ?? false,
  shift: modifiers.shift ?? false,
});

export const commandDefinitions = {
  quickActions: {
    configuration: "configurable",
    defaultBinding: binding("p", { primary: true, shift: true }),
    group: "General",
    id: "system.quick-actions",
    label: "Open Quick Actions",
    scopes: ["global"],
    visibleControlOwner: "Main titlebar and Reader navigation",
  },
  settings: {
    configuration: "configurable",
    defaultBinding: binding(",", { primary: true }),
    group: "General",
    id: "system.open-settings",
    label: "Open Settings",
    scopes: ["global"],
    visibleControlOwner: "Library sidebar",
  },
  focusSearch: {
    configuration: "configurable",
    defaultBinding: binding("f", { primary: true }),
    group: "Library and Folders",
    id: "surface.focus-search",
    label: "Focus search",
    showInPalette: false,
    scopes: ["library", "folders", "settings", "reader"],
  },
  readerToc: {
    configuration: "configurable",
    defaultBinding: binding("t"),
    group: "Reader",
    id: "reader.open-toc",
    label: "Toggle table of contents",
    scopes: ["reader"],
    visibleControlOwner: "Reader toolbar",
  },
  readerAnnotations: {
    configuration: "configurable",
    defaultBinding: binding("a"),
    group: "Reader",
    id: "reader.open-annotations",
    label: "Toggle annotations",
    scopes: ["reader"],
    visibleControlOwner: "Reader toolbar",
  },
  readerBookmark: {
    configuration: "configurable",
    defaultBinding: binding("b"),
    group: "Reader",
    id: "reader.toggle-bookmark",
    label: "Toggle bookmark",
    scopes: ["reader"],
    visibleControlOwner: "Reader toolbar",
  },
  readerSettings: {
    configuration: "configurable",
    defaultBinding: binding("s"),
    group: "Reader",
    id: "reader.open-reading-settings",
    label: "Toggle reader settings",
    scopes: ["reader"],
    visibleControlOwner: "Reader toolbar",
  },
  closeTopmostSurface: {
    configuration: "fixed",
    defaultBinding: binding("escape"),
    group: "Fixed Interaction Keys",
    id: "interaction.close-topmost",
    label: "Close the topmost surface",
    scopes: ["transient-surface", "settings", "reader", "folders", "library", "global"],
  },
  readerPreviousPage: {
    configuration: "fixed",
    defaultBinding: binding("arrowleft"),
    group: "Fixed Interaction Keys",
    id: "reader.previous-page",
    label: "Previous reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
  readerNextPage: {
    configuration: "fixed",
    defaultBinding: binding("arrowright"),
    group: "Fixed Interaction Keys",
    id: "reader.next-page",
    label: "Next reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
  readerPreviousPageKey: {
    configuration: "fixed",
    defaultBinding: binding("pageup"),
    group: "Fixed Interaction Keys",
    id: "reader.previous-page-page-up",
    label: "Previous reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
  readerNextPageKey: {
    configuration: "fixed",
    defaultBinding: binding("pagedown"),
    group: "Fixed Interaction Keys",
    id: "reader.next-page-page-down",
    label: "Next reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
  readerPreviousPageSpace: {
    configuration: "fixed",
    defaultBinding: binding("space", { shift: true }),
    group: "Fixed Interaction Keys",
    id: "reader.previous-page-shift-space",
    label: "Previous reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
  readerNextPageSpace: {
    configuration: "fixed",
    defaultBinding: binding("space"),
    group: "Fixed Interaction Keys",
    id: "reader.next-page-space",
    label: "Next reader page",
    repeatPolicy: "allow",
    scopes: ["reader"],
  },
} as const satisfies Record<string, CommandDefinition>;

export type ConfigurableCommandId =
  | typeof commandDefinitions.quickActions.id
  | typeof commandDefinitions.settings.id
  | typeof commandDefinitions.focusSearch.id
  | typeof commandDefinitions.readerToc.id
  | typeof commandDefinitions.readerAnnotations.id
  | typeof commandDefinitions.readerBookmark.id
  | typeof commandDefinitions.readerSettings.id;

export const configurableCommandDefinitions: readonly CommandDefinition[] = [
  commandDefinitions.quickActions,
  commandDefinitions.settings,
  commandDefinitions.focusSearch,
  commandDefinitions.readerToc,
  commandDefinitions.readerAnnotations,
  commandDefinitions.readerBookmark,
  commandDefinitions.readerSettings,
];

export const fixedInteractionCommandDefinitions: readonly CommandDefinition[] = [
  commandDefinitions.closeTopmostSurface,
  commandDefinitions.readerPreviousPage,
  commandDefinitions.readerNextPage,
  commandDefinitions.readerPreviousPageKey,
  commandDefinitions.readerNextPageKey,
  commandDefinitions.readerPreviousPageSpace,
  commandDefinitions.readerNextPageSpace,
];

const configurableDefinitionsById = new Map(
  configurableCommandDefinitions.map((definition) => [definition.id, definition]),
);

const DISPLAY_KEY_LABELS: Record<string, string> = {
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  backspace: "Backspace",
  contextmenu: "Menu",
  delete: "Delete",
  end: "End",
  enter: "Enter",
  escape: "Esc",
  home: "Home",
  pagedown: "Page Down",
  pageup: "Page Up",
  space: "Space",
  tab: "Tab",
};

const FIXED_INTERACTION_KEYS = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "contextmenu",
  "delete",
  "end",
  "enter",
  "escape",
  "f2",
  "home",
  "pagedown",
  "pageup",
  "space",
  "tab",
]);

const RESERVED_PRIMARY_BINDINGS = new Set([
  "primary+l",
  "primary+n",
  "primary+p",
  "primary+r",
  "primary+t",
  "primary+w",
  "primary+shift+i",
  "primary+shift+r",
]);

const RESERVED_EDITING_BINDINGS = new Set([
  "primary+a",
  "primary+c",
  "primary+v",
  "primary+x",
  "primary+y",
  "primary+z",
  "primary+shift+z",
  "primary+backspace",
  "primary+delete",
]);

export const defaultKeyboardPreferences: Readonly<KeyboardPreferences> = Object.freeze({
  shortcuts: Object.freeze({}),
});

export function normalizeBindingKey(value: string): string {
  if (value === " ") return "space";
  const normalized = value.trim().toLowerCase();
  if (normalized === "spacebar") return "space";
  if (normalized === "esc") return "escape";
  return normalized;
}

export function detectKeyboardPlatform(
  navigatorValue: Pick<Navigator, "platform" | "userAgent"> | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator,
): KeyboardPlatform {
  const platform = `${navigatorValue?.platform ?? ""} ${navigatorValue?.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "windows-linux";
}

export function normalizeKeyboardBinding(value: unknown): KeyboardBinding | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === "string" ? normalizeBindingKey(value.key) : "";
  if (!key) return null;

  const legacyPrimary = value.ctrl === true || value.meta === true;
  return {
    alt: value.alt === true,
    key,
    primary: value.primary === true || (value.primary === undefined && legacyPrimary),
    shift: value.shift === true,
  };
}

export function keyboardEventOwnershipError(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
  platform: KeyboardPlatform = detectKeyboardPlatform(),
): string | null {
  if (platform === "mac" && event.ctrlKey) {
    return "Use Command instead of Control for Archeion shortcuts on macOS.";
  }
  if (platform === "windows-linux" && event.metaKey) {
    return "Shortcuts using the Windows or Meta key cannot be owned reliably.";
  }
  return null;
}

export function keyboardBindingFromEvent(
  event: KeyboardEvent,
  platform: KeyboardPlatform = detectKeyboardPlatform(),
): KeyboardBinding | null {
  if (keyboardEventOwnershipError(event, platform)) return null;

  const key = normalizeBindingKey(event.key);
  if (!key || key === "control" || key === "shift" || key === "alt" || key === "meta") {
    return null;
  }

  return {
    alt: event.altKey,
    key,
    primary: platform === "mac" ? event.metaKey : event.ctrlKey,
    shift: event.shiftKey,
  };
}

export function keyboardBindingsEqual(
  left: KeyboardBinding | undefined,
  right: KeyboardBinding | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.alt === right.alt &&
    left.key === right.key &&
    left.primary === right.primary &&
    left.shift === right.shift,
  );
}

export function formatKeyboardBinding(
  value: KeyboardBinding | undefined,
  platform: KeyboardPlatform = detectKeyboardPlatform(),
): string | undefined {
  if (!value) return undefined;
  const parts: string[] = [];
  if (value.primary) parts.push(platform === "mac" ? "Command" : "Ctrl");
  if (value.alt) parts.push(platform === "mac" ? "Option" : "Alt");
  if (value.shift) parts.push("Shift");
  parts.push(DISPLAY_KEY_LABELS[value.key] ?? displayPrintableKey(value.key));
  return parts.join("+");
}

export function ariaKeyShortcut(
  value: KeyboardBinding | undefined,
  platform: KeyboardPlatform = detectKeyboardPlatform(),
): string | undefined {
  if (!value) return undefined;
  const parts: string[] = [];
  if (value.primary) parts.push(platform === "mac" ? "Meta" : "Control");
  if (value.alt) parts.push("Alt");
  if (value.shift) parts.push("Shift");
  parts.push(ariaKeyLabel(value.key));
  return parts.join("+");
}

export function effectiveKeyboardBinding(
  definition: Pick<CommandDefinition, "configuration" | "defaultBinding" | "id">,
  preferences: KeyboardPreferences,
): KeyboardBinding | undefined {
  if (definition.configuration === "unbound") return undefined;
  if (definition.configuration === "fixed") return definition.defaultBinding;

  const override = preferences.shortcuts[definition.id];
  if (!override) return definition.defaultBinding;
  return "disabled" in override ? undefined : override.binding;
}

export function setKeyboardShortcutOverride(
  preferences: KeyboardPreferences,
  commandId: ConfigurableCommandId,
  override: KeyboardShortcutOverride | undefined,
): KeyboardPreferences {
  const shortcuts = { ...preferences.shortcuts };
  if (override) shortcuts[commandId] = override;
  else delete shortcuts[commandId];
  return { shortcuts };
}

export type KeyboardBindingConflict = {
  binding: KeyboardBinding;
  commandIds: readonly [string, string];
};

export type KeyboardBindingValidation =
  { ok: true } | { conflict?: KeyboardBindingConflict; ok: false; reason: string };

export function findKeyboardBindingConflict(
  commandId: string,
  candidate: KeyboardBinding,
  preferences: KeyboardPreferences,
): KeyboardBindingConflict | null {
  const definition = configurableDefinitionsById.get(commandId);
  if (!definition) return null;

  for (const other of configurableCommandDefinitions) {
    if (other.id === definition.id || !commandScopesOverlap(definition.scopes, other.scopes)) {
      continue;
    }
    if (keyboardBindingsEqual(candidate, effectiveKeyboardBinding(other, preferences))) {
      return {
        binding: candidate,
        commandIds: [definition.id, other.id],
      };
    }
  }

  return null;
}

export function findKeyboardPreferenceConflicts(
  preferences: KeyboardPreferences,
): readonly KeyboardBindingConflict[] {
  const conflicts: KeyboardBindingConflict[] = [];
  const seen = new Set<string>();

  for (const definition of configurableCommandDefinitions) {
    const candidate = effectiveKeyboardBinding(definition, preferences);
    if (!candidate) continue;
    const conflict = findKeyboardBindingConflict(definition.id, candidate, preferences);
    if (!conflict) continue;
    const key = [...conflict.commandIds].sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      conflicts.push(conflict);
    }
  }

  return conflicts;
}

export function assertKeyboardPreferencesHaveNoConflicts(preferences: KeyboardPreferences): void {
  const conflict = findKeyboardPreferenceConflicts(preferences)[0];
  if (!conflict) return;
  throw new Error(conflictReason(conflict));
}

export function validateKeyboardBinding(
  commandId: string,
  candidate: KeyboardBinding,
  preferences: KeyboardPreferences,
): KeyboardBindingValidation {
  const definition = configurableDefinitionsById.get(commandId);
  if (!definition) {
    return { ok: false, reason: "This command cannot be configured." };
  }

  const ownershipError = keyboardOwnershipError(definition, candidate);
  if (ownershipError) return { ok: false, reason: ownershipError };

  const conflict = findKeyboardBindingConflict(commandId, candidate, preferences);
  if (conflict) {
    return { conflict, ok: false, reason: conflictReason(conflict) };
  }

  return { ok: true };
}

type PersistedKeyboardCandidate =
  { kind: "default" } | { kind: "disabled" } | { binding: KeyboardBinding; kind: "override" };

function effectivePersistedCandidateBinding(
  definition: CommandDefinition,
  candidate: PersistedKeyboardCandidate,
): KeyboardBinding | undefined {
  if (candidate.kind === "disabled") return undefined;
  return candidate.kind === "override" ? candidate.binding : definition.defaultBinding;
}

function findPersistedCandidateConflict(
  candidates: readonly PersistedKeyboardCandidate[],
): readonly [number, number] | null {
  for (let leftIndex = 0; leftIndex < configurableCommandDefinitions.length; leftIndex += 1) {
    const leftDefinition = configurableCommandDefinitions[leftIndex];
    const leftBinding = effectivePersistedCandidateBinding(leftDefinition, candidates[leftIndex]);
    if (!leftBinding) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < configurableCommandDefinitions.length;
      rightIndex += 1
    ) {
      const rightDefinition = configurableCommandDefinitions[rightIndex];
      if (!commandScopesOverlap(leftDefinition.scopes, rightDefinition.scopes)) continue;

      const rightBinding = effectivePersistedCandidateBinding(
        rightDefinition,
        candidates[rightIndex],
      );
      if (keyboardBindingsEqual(leftBinding, rightBinding)) {
        return [leftIndex, rightIndex];
      }
    }
  }

  return null;
}

function resolvePersistedKeyboardCandidates(
  candidates: PersistedKeyboardCandidate[],
): PersistedKeyboardCandidate[] {
  for (let attempt = 0; attempt <= configurableCommandDefinitions.length; attempt += 1) {
    const conflict = findPersistedCandidateConflict(candidates);
    if (!conflict) return candidates;

    const [leftIndex, rightIndex] = conflict;
    const left = candidates[leftIndex];
    const right = candidates[rightIndex];

    if (left.kind === "override" && right.kind === "override") {
      candidates[rightIndex] = { kind: "default" };
      continue;
    }
    if (left.kind === "override" && right.kind === "default") {
      candidates[leftIndex] = { kind: "default" };
      continue;
    }
    if (left.kind === "default" && right.kind === "override") {
      candidates[rightIndex] = { kind: "default" };
      continue;
    }

    throw new Error("Configurable command defaults must not conflict.");
  }

  throw new Error("Persisted keyboard conflict resolution exceeded the command bound.");
}

export function normalizeKeyboardPreferences(value: unknown): KeyboardPreferences {
  const storedShortcuts = isRecord(value) && isRecord(value.shortcuts) ? value.shortcuts : {};
  const candidates = configurableCommandDefinitions.map<PersistedKeyboardCandidate>(
    (definition) => {
      const stored = storedShortcuts[definition.id];
      if (!isRecord(stored)) return { kind: "default" };

      if (stored.disabled === true) return { kind: "disabled" };

      const storedBinding = normalizeKeyboardBinding(stored.binding);
      if (!storedBinding || keyboardOwnershipError(definition, storedBinding)) {
        return { kind: "default" };
      }
      if (keyboardBindingsEqual(storedBinding, definition.defaultBinding)) {
        return { kind: "default" };
      }

      return { binding: storedBinding, kind: "override" };
    },
  );
  const resolved = resolvePersistedKeyboardCandidates(candidates);
  let normalized: KeyboardPreferences = { shortcuts: {} };

  for (const [index, definition] of configurableCommandDefinitions.entries()) {
    const candidate = resolved[index];
    if (candidate.kind === "default") continue;
    normalized = setKeyboardShortcutOverride(
      normalized,
      definition.id as ConfigurableCommandId,
      candidate.kind === "disabled" ? { disabled: true } : { binding: candidate.binding },
    );
  }
  assertKeyboardPreferencesHaveNoConflicts(normalized);
  return normalized;
}

export function commandScopesOverlap(
  left: readonly CommandScope[],
  right: readonly CommandScope[],
): boolean {
  if (left.includes("global") || right.includes("global")) return true;
  return left.some((scope) => right.includes(scope));
}

export function getConfigurableCommandDefinition(commandId: string): CommandDefinition | undefined {
  return configurableDefinitionsById.get(commandId);
}

function keyboardOwnershipError(
  definition: CommandDefinition,
  candidate: KeyboardBinding,
): string | null {
  const label = formatKeyboardBinding(candidate) ?? "This shortcut";

  if (candidate.alt) {
    return "Shortcuts using Alt or Option are reserved for system and assistive-technology interactions.";
  }

  if (FIXED_INTERACTION_KEYS.has(candidate.key)) {
    return `${label} uses a fixed interaction key and cannot be reassigned.`;
  }

  if (/^f\d{1,2}$/.test(candidate.key)) {
    return "Function keys are reserved for the operating system, WebView, and assistive technology.";
  }

  const readerOnly = definition.scopes.every((scope) => scope === "reader");
  if (!candidate.primary && !readerOnly) {
    return "This shortcut must include the application primary modifier.";
  }

  if (!candidate.primary && !/^[a-z0-9]$/.test(candidate.key)) {
    return "Unmodified reader shortcuts must use a letter or number key.";
  }

  const signature = keyboardBindingSignature(candidate);
  if (RESERVED_PRIMARY_BINDINGS.has(signature)) {
    return `${label} is reserved by the operating system or application WebView.`;
  }

  if (RESERVED_EDITING_BINDINGS.has(signature)) {
    return `${label} is reserved for text editing.`;
  }

  return null;
}

function conflictReason(conflict: KeyboardBindingConflict): string {
  const label = formatKeyboardBinding(conflict.binding) ?? "This shortcut";
  const [leftId, rightId] = conflict.commandIds;
  return `${label} conflicts between ${leftId} and ${rightId}.`;
}

function keyboardBindingSignature(value: KeyboardBinding): string {
  return [
    value.primary ? "primary" : "",
    value.alt ? "alt" : "",
    value.shift ? "shift" : "",
    value.key,
  ]
    .filter(Boolean)
    .join("+");
}

function displayPrintableKey(key: string): string {
  if (key.length === 1) return key.toLocaleUpperCase();
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

function ariaKeyLabel(key: string): string {
  switch (key) {
    case "space":
      return "Space";
    case "escape":
      return "Escape";
    case "arrowleft":
      return "ArrowLeft";
    case "arrowright":
      return "ArrowRight";
    case "arrowup":
      return "ArrowUp";
    case "arrowdown":
      return "ArrowDown";
    case "pageup":
      return "PageUp";
    case "pagedown":
      return "PageDown";
    default:
      return displayPrintableKey(key);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

assertKeyboardPreferencesHaveNoConflicts(defaultKeyboardPreferences);
