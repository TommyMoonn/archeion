import {
  createSearchQuery,
  createSearchTextVariants,
  scoreSearchField,
  searchFieldsMatchQuery,
  type SearchTextVariants,
} from "../../utils/searchText";
import type {
  CommandConfigurationPolicy,
  CommandRepeatPolicy,
  CommandScope,
  KeyboardBinding,
} from "./commandBindings";

export const QUICK_ACTION_SEARCH_BOOKS_REQUEST = "search-books";

export function requestsBookSearch(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "quickAction" in state &&
    state.quickAction === QUICK_ACTION_SEARCH_BOOKS_REQUEST
  );
}

export type QuickActionCommandAvailability =
  { available: true } | { available: false; reason: string };

export type QuickActionCommand = {
  allowInTextEntry?: boolean;
  allowWithSelection?: boolean;
  availability?: QuickActionCommandAvailability;
  canHandleEvent?: (
    event: KeyboardEvent,
    context: import("./commandResolver").KeyboardInteractionContext,
  ) => boolean;
  configuration?: CommandConfigurationPolicy;
  defaultBinding?: KeyboardBinding;
  execute: () => Promise<void> | void;
  group:
    | "Archive"
    | "General"
    | "Library"
    | "Library and Folders"
    | "Navigate"
    | "Reader"
    | "System"
    | "Fixed Interaction Keys";
  id: string;
  keywords?: readonly string[];
  label: string;
  order?: number;
  priority?: number;
  repeatPolicy?: CommandRepeatPolicy;
  scope?: CommandScope;
  showInPalette?: boolean;
  visibleControlOwner?: string;
};

export type QuickActionsSnapshot = {
  commands: readonly QuickActionCommand[];
  recentCommandIds: readonly string[];
};

type Registration = {
  commands: readonly QuickActionCommand[];
  token: symbol;
};

type Listener = () => void;

const MAX_RECENT_COMMANDS = 8;

export class QuickActionsRegistry {
  private readonly registrations = new Map<string, Registration>();
  private readonly listeners = new Set<Listener>();
  private recentCommandIds: string[] = [];
  private snapshot: QuickActionsSnapshot = {
    commands: [],
    recentCommandIds: [],
  };

  getSnapshot = (): QuickActionsSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  register(sourceId: string, commands: readonly QuickActionCommand[]): () => void {
    const token = Symbol(sourceId);
    const previousRegistration = this.registrations.get(sourceId);
    this.registrations.set(sourceId, { commands: [...commands], token });

    try {
      this.publish();
    } catch (error) {
      if (previousRegistration) {
        this.registrations.set(sourceId, previousRegistration);
      } else {
        this.registrations.delete(sourceId);
      }
      this.publish();
      throw error;
    }

    return () => {
      if (this.registrations.get(sourceId)?.token !== token) return;
      this.registrations.delete(sourceId);
      this.publish();
    };
  }

  recordRecent(commandId: string): void {
    this.recentCommandIds = [
      commandId,
      ...this.recentCommandIds.filter((candidate) => candidate !== commandId),
    ].slice(0, MAX_RECENT_COMMANDS);
    this.publish();
  }

  private publish(): void {
    const commands = [...this.registrations.values()].flatMap((registration) => [
      ...registration.commands,
    ]);
    const commandKeys = new Set<string>();

    for (const command of commands) {
      const commandKey = `${command.id}:${command.scope ?? "global"}`;
      if (commandKeys.has(commandKey)) {
        throw new Error(`Duplicate command registration: ${commandKey}`);
      }
      commandKeys.add(commandKey);
    }

    const commandIds = new Set(commands.map((command) => command.id));
    this.snapshot = {
      commands,
      recentCommandIds: this.recentCommandIds.filter((commandId) => commandIds.has(commandId)),
    };
    this.listeners.forEach((listener) => listener());
  }
}

type IndexedQuickAction = {
  command: QuickActionCommand;
  disabledReason: SearchTextVariants;
  group: SearchTextVariants;
  keywords: SearchTextVariants;
  label: SearchTextVariants;
};

export function createQuickActionIndex(
  commands: readonly QuickActionCommand[],
): readonly IndexedQuickAction[] {
  return commands
    .filter((command) => command.showInPalette !== false)
    .map((command) => {
      const availability = command.availability;
      return {
        command,
        disabledReason: createSearchTextVariants(
          availability?.available === false ? availability.reason : undefined,
        ),
        group: createSearchTextVariants(command.group),
        keywords: createSearchTextVariants(command.keywords?.join(" ")),
        label: createSearchTextVariants(command.label),
      };
    });
}

export function searchQuickActions(
  index: readonly IndexedQuickAction[],
  queryValue: string,
  recentCommandIds: readonly string[],
): QuickActionCommand[] {
  const query = createSearchQuery(queryValue);
  const recentRank = new Map(recentCommandIds.map((commandId, position) => [commandId, position]));

  return index
    .map((entry) => {
      const fields = [entry.label, entry.keywords, entry.group, entry.disabledReason];
      if (!searchFieldsMatchQuery(fields, query)) return null;

      const recentPosition = recentRank.get(entry.command.id);
      const recentScore = recentPosition === undefined ? 0 : 1_000 - recentPosition * 25;
      const searchScore =
        scoreSearchField(entry.label, query) * 4 +
        scoreSearchField(entry.keywords, query) * 2 +
        scoreSearchField(entry.group, query) +
        scoreSearchField(entry.disabledReason, query);

      return { command: entry.command, recentScore, searchScore };
    })
    .filter(
      (
        entry,
      ): entry is {
        command: QuickActionCommand;
        recentScore: number;
        searchScore: number;
      } => entry !== null,
    )
    .sort((left, right) => {
      if (query.terms.length > 0 && right.searchScore !== left.searchScore) {
        return right.searchScore - left.searchScore;
      }
      if (right.recentScore !== left.recentScore) return right.recentScore - left.recentScore;
      const orderDifference = (left.command.order ?? 100) - (right.command.order ?? 100);
      if (orderDifference !== 0) return orderDifference;
      return left.command.label.localeCompare(right.command.label);
    })
    .map((entry) => entry.command);
}

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
