import type {
  CommandConfigurationPolicy,
  CommandRepeatPolicy,
  CommandScope,
  KeyboardBinding,
  KeyboardPlatform,
} from "./commandBindings";

export type AppCommandAvailability = { available: true } | { available: false; reason: string };

export type KeyboardInteractionContext = {
  applicationDocument: Document;
  platform?: KeyboardPlatform;
  sourceDocument: Document;
};

export type AppCommand = {
  allowInReaderSideSurface?: boolean;
  allowInTextEntry?: boolean;
  allowWithSelection?: boolean;
  availability?: AppCommandAvailability;
  canHandleEvent?: (event: KeyboardEvent, context: KeyboardInteractionContext) => boolean;
  configuration: CommandConfigurationPolicy;
  defaultBinding?: KeyboardBinding;
  execute: () => Promise<void> | void;
  group:
    | "Appearance"
    | "Archive"
    | "General"
    | "Library"
    | "Library and Folders"
    | "Navigate"
    | "Reader"
    | "System"
    | "Fixed Interaction Keys";
  id: string;
  label: string;
  priority?: number;
  repeatPolicy?: CommandRepeatPolicy;
  scope: CommandScope;
  visibleControlOwner?: string;
};

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const TEXT_CONTENTEDITABLE_VALUES = new Set(["", "plaintext-only", "true"]);

export function isTextEntryTarget(target: EventTarget | null): boolean {
  let element = eventTargetElement(target);

  while (element) {
    const tagName = element.localName.toLocaleLowerCase();

    if (tagName === "input") {
      const inputType = normalizedAttribute(element, "type") || "text";
      return !NON_TEXT_INPUT_TYPES.has(inputType);
    }

    if (tagName === "textarea") return true;

    const contentEditable = normalizedAttribute(element, "contenteditable");
    if (contentEditable === "false") return false;
    if (contentEditable !== null && TEXT_CONTENTEDITABLE_VALUES.has(contentEditable)) return true;
    if (normalizedAttribute(element, "role") === "textbox") return true;
    if (tagName === "button") return false;

    element = element.parentElement;
  }

  return false;
}

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;

  const candidate = target as Element;
  const elementConstructor = candidate.ownerDocument?.defaultView?.Element;
  if (typeof elementConstructor === "function" && candidate instanceof elementConstructor) {
    return candidate;
  }

  return candidate.nodeType === 1 &&
    typeof candidate.localName === "string" &&
    typeof candidate.getAttribute === "function"
    ? candidate
    : null;
}

function normalizedAttribute(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : value.trim().toLocaleLowerCase();
}
