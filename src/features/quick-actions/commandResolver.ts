import { ACTIVE_CONTEXT_MENU_SELECTOR } from "../../components/contextMenuController";
import {
  effectiveKeyboardBinding,
  commandScopesOverlap,
  keyboardBindingFromEvent,
  keyboardBindingsEqual,
  type CommandScope,
  type KeyboardPlatform,
  type KeyboardPreferences,
} from "./commandBindings";
import {
  isTextEntryTarget,
  type QuickActionCommand,
  type QuickActionCommandAvailability,
} from "./quickActions";

const SCOPE_PRIORITY: Record<CommandScope, number> = {
  "transient-surface": 600,
  settings: 500,
  reader: 500,
  folders: 400,
  library: 300,
  global: 100,
};

export type KeyboardInteractionContext = {
  applicationDocument: Document;
  platform?: KeyboardPlatform;
  sourceDocument: Document;
};

export type ResolvedKeyboardCommand = {
  availability: QuickActionCommandAvailability;
  command: QuickActionCommand;
};

export function createKeyboardInteractionContext(
  event: KeyboardEvent,
  applicationDocument: Document = document,
): KeyboardInteractionContext {
  return {
    applicationDocument,
    sourceDocument: eventTargetElement(event.target)?.ownerDocument ?? applicationDocument,
  };
}

export function resolveKeyboardCommand(
  event: KeyboardEvent,
  commands: readonly QuickActionCommand[],
  preferences: KeyboardPreferences,
  context: KeyboardInteractionContext = createKeyboardInteractionContext(event),
): ResolvedKeyboardCommand | null {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;

  const eventBinding = keyboardBindingFromEvent(event, context.platform);
  if (!eventBinding) return null;

  const candidates = commands.filter((command) => {
    const configuredBinding = effectiveKeyboardBinding(command, preferences);
    if (!keyboardBindingsEqual(configuredBinding, eventBinding)) return false;
    if (event.repeat && (command.repeatPolicy ?? "ignore") === "ignore") return false;
    return commandCanOwnEvent(command, event, context);
  });

  if (candidates.length > 1) {
    const overlapping = candidates.filter((candidate, index) =>
      candidates.some(
        (other, otherIndex) =>
          index !== otherIndex && commandScopesOverlap([candidate.scope], [other.scope]),
      ),
    );
    if (overlapping.length > 1) {
      throw new Error(
        `Conflicting keyboard command registrations: ${overlapping
          .map((command) => `${command.id}:${command.scope}`)
          .join(", ")}`,
      );
    }
  }

  const command = candidates.sort((left, right) => {
    const scopeDifference = SCOPE_PRIORITY[right.scope] - SCOPE_PRIORITY[left.scope];
    if (scopeDifference !== 0) return scopeDifference;
    return (right.priority ?? 0) - (left.priority ?? 0);
  })[0];

  if (!command) return null;
  return { availability: commandAvailability(command), command };
}

export function commandAvailability(
  command: Pick<QuickActionCommand, "availability">,
): QuickActionCommandAvailability {
  return command.availability ?? { available: true };
}

function commandCanOwnEvent(
  command: QuickActionCommand,
  event: KeyboardEvent,
  context: KeyboardInteractionContext,
): boolean {
  if (command.canHandleEvent && !command.canHandleEvent(event, context)) return false;
  if (context.applicationDocument.querySelector(ACTIVE_CONTEXT_MENU_SELECTOR)) return false;

  const target = eventTargetElement(event.target);
  const modalScope = activeApplicationModalScope(context.applicationDocument, target);
  if (modalScope && command.scope !== modalScope && command.scope !== "transient-surface") {
    return false;
  }

  if (isTextEntryTarget(event.target) && !command.allowInTextEntry) return false;
  if (hasActiveSelection(context.sourceDocument) && !command.allowWithSelection) return false;
  if (target?.closest("[data-reader-ignore-shortcuts]")) {
    return command.scope === "transient-surface" || command.scope === "settings";
  }

  return true;
}

function activeApplicationModalScope(
  applicationDocument: Document,
  target: Element | null,
): CommandScope | null {
  const closestDialog =
    target?.ownerDocument === applicationDocument
      ? target.closest<HTMLDialogElement>("dialog[open]")
      : null;
  const openDialogs = applicationDocument.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const openDialog = closestDialog ?? openDialogs.item(openDialogs.length - 1);
  if (!openDialog) return null;
  if (openDialog.classList.contains("settings-dialog")) return "settings";
  return "transient-surface";
}

function hasActiveSelection(sourceDocument: Document): boolean {
  const selection = sourceDocument.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<Element>;
  return candidate.nodeType === 1 && typeof candidate.closest === "function"
    ? (target as Element)
    : null;
}
