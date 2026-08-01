import {
  createSearchQuery,
  createSearchTextVariants,
  scoreSearchField,
  searchFieldsMatchQuery,
} from "../../utils/searchText";
import type { AppCommandAvailability } from "../commands/appCommands";

export type QuickActionModeOption = {
  availability?: AppCommandAvailability;
  id: string;
  keywords?: readonly string[];
  label: string;
  status?: string;
};

export type QuickActionModeSnapshot = {
  committedOptionId?: string;
  options: readonly QuickActionModeOption[];
  unavailableReason?: string;
};

export type QuickActionPaletteOutcome =
  | { kind: "close" }
  | { error?: string; kind: "keep-open" }
  | { kind: "child-mode"; mode: QuickActionChildMode };

export type QuickActionChildMode = {
  confirm: (
    option: QuickActionModeOption,
  ) => Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome;
  dispose: () => void;
  getSnapshot: () => QuickActionModeSnapshot;
  id: string;
  placeholder: string;
  preview?: (option: QuickActionModeOption | undefined) => void;
  subscribe: (listener: () => void) => () => void;
  title: string;
};

type QuickActionChildModeDescriptor = {
  confirm: QuickActionChildMode["confirm"];
  id: string;
  onDispose?: () => void;
  placeholder: string;
  preview?: QuickActionChildMode["preview"];
  snapshot: QuickActionModeSnapshot;
  title: string;
};

export class QuickActionChildModeSession implements QuickActionChildMode {
  readonly id: string;
  readonly placeholder: string;
  readonly preview?: QuickActionChildMode["preview"];
  readonly title: string;

  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: QuickActionModeSnapshot;

  constructor(private readonly descriptor: QuickActionChildModeDescriptor) {
    this.id = descriptor.id;
    this.placeholder = descriptor.placeholder;
    this.preview = descriptor.preview;
    this.snapshot = copySnapshot(descriptor.snapshot);
    this.title = descriptor.title;
  }

  getSnapshot = (): QuickActionModeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  confirm = (
    option: QuickActionModeOption,
  ): Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome =>
    this.descriptor.confirm(option);

  replaceOptions(options: readonly QuickActionModeOption[]): void {
    if (this.disposed) return;
    this.snapshot = copySnapshot({ ...this.snapshot, options });
    this.listeners.forEach((listener) => listener());
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.descriptor.onDispose?.();
  };
}

export function searchQuickActionModeOptions(
  options: readonly QuickActionModeOption[],
  queryValue: string,
): QuickActionModeOption[] {
  const query = createSearchQuery(queryValue);

  return options
    .map((option, index) => {
      const label = createSearchTextVariants(option.label);
      const keywords = createSearchTextVariants(option.keywords?.join(" "));
      const status = createSearchTextVariants(option.status);
      const reason = createSearchTextVariants(
        option.availability?.available === false ? option.availability.reason : undefined,
      );
      if (!searchFieldsMatchQuery([label, keywords, status, reason], query)) return null;

      return {
        index,
        option,
        score:
          scoreSearchField(label, query) * 4 +
          scoreSearchField(keywords, query) * 2 +
          scoreSearchField(status, query) +
          scoreSearchField(reason, query),
      };
    })
    .filter(
      (result): result is { index: number; option: QuickActionModeOption; score: number } =>
        result !== null,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((result) => result.option);
}

function copySnapshot(snapshot: QuickActionModeSnapshot): QuickActionModeSnapshot {
  return { ...snapshot, options: [...snapshot.options] };
}
