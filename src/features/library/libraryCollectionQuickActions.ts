import type { LibraryCollectionPreferences, LibraryLocation } from "../../types/library";
import { folderSortOptions } from "../folders/folderSortOptions";
import { QuickActionChildModeSession } from "../quick-actions/quickActionModes";
import type { QuickActionRegistration } from "../quick-actions/quickActions";
import { seriesSortOptions } from "../series/seriesSortOptions";
import { cardSizeOptions, folderViewOptions, viewOptions } from "../settings/settingsOptions";
import { librarySortOptions } from "./librarySortOptions";

type CollectionKey = keyof LibraryCollectionPreferences;
type CollectionUpdate = <TKey extends CollectionKey>(
  collection: TKey,
  changes: Partial<LibraryCollectionPreferences[TKey]>,
) => Promise<unknown>;

type DisplayOption<TValue extends string> = Readonly<{
  label: string;
  value: TValue;
}>;

type ModeDescriptor = {
  commandId: string;
  currentValue: string;
  label: string;
  options: readonly Readonly<{
    id: string;
    label: string;
    persist: () => Promise<unknown>;
  }>[];
  order: number;
  settingLabel: string;
};

type CollectionQuickActionOptions = {
  collections: LibraryCollectionPreferences;
  location: LibraryLocation;
  updateCollection: CollectionUpdate;
};

export function createLibraryCollectionQuickActions({
  collections,
  location,
  updateCollection,
}: CollectionQuickActionOptions): QuickActionRegistration[] {
  if (location.type === "series-detail") return [];

  if (location.type === "folders") {
    const preferences = collections.folders;
    return createCollectionCommands([
      createDescriptor({
        commandId: "library.change-collection-view",
        currentValue: preferences.viewMode,
        label: "Change Folder view…",
        options: folderViewOptions,
        order: 42,
        settingLabel: "folder view",
        persist: (viewMode) => updateCollection("folders", { viewMode }),
      }),
      createDescriptor({
        commandId: "library.change-collection-sort",
        currentValue: preferences.sortBy,
        label: "Change Folder sort…",
        options: folderSortOptions,
        order: 43,
        settingLabel: "folder sort",
        persist: (sortBy) => updateCollection("folders", { sortBy }),
      }),
      ...(preferences.viewMode === "cards"
        ? [
            createDescriptor({
              commandId: "library.change-collection-card-size",
              currentValue: preferences.cardSize,
              label: "Change Folder card size…",
              options: cardSizeOptions,
              order: 44,
              settingLabel: "folder card size",
              persist: (cardSize) => updateCollection("folders", { cardSize }),
            }),
          ]
        : []),
    ]);
  }

  if (location.type === "series") {
    const preferences = collections.series;
    return createCollectionCommands([
      createDescriptor({
        commandId: "library.change-collection-view",
        currentValue: preferences.viewMode,
        label: "Change Series view…",
        options: viewOptions,
        order: 42,
        settingLabel: "series view",
        persist: (viewMode) => updateCollection("series", { viewMode }),
      }),
      createDescriptor({
        commandId: "library.change-collection-sort",
        currentValue: preferences.sortBy,
        label: "Change Series sort…",
        options: seriesSortOptions,
        order: 43,
        settingLabel: "series sort",
        persist: (sortBy) => updateCollection("series", { sortBy }),
      }),
      ...(preferences.viewMode === "grid"
        ? [
            createDescriptor({
              commandId: "library.change-collection-card-size",
              currentValue: preferences.cardSize,
              label: "Change Series card size…",
              options: cardSizeOptions,
              order: 44,
              settingLabel: "series card size",
              persist: (cardSize) => updateCollection("series", { cardSize }),
            }),
          ]
        : []),
    ]);
  }

  const preferences = collections.books;
  return createCollectionCommands([
    createDescriptor({
      commandId: "library.change-collection-view",
      currentValue: preferences.viewMode,
      label: "Change view…",
      options: viewOptions,
      order: 42,
      settingLabel: "book view",
      persist: (viewMode) => updateCollection("books", { viewMode }),
    }),
    createDescriptor({
      commandId: "library.change-collection-sort",
      currentValue: preferences.sortBy,
      label: "Change sort…",
      options: librarySortOptions,
      order: 43,
      settingLabel: "book sort",
      persist: (sortBy) => updateCollection("books", { sortBy }),
    }),
    ...(preferences.viewMode === "grid"
      ? [
          createDescriptor({
            commandId: "library.change-collection-card-size",
            currentValue: preferences.cardSize,
            label: "Change card size…",
            options: cardSizeOptions,
            order: 44,
            settingLabel: "book card size",
            persist: (cardSize) => updateCollection("books", { cardSize }),
          }),
        ]
      : []),
  ]);
}

function createDescriptor<TValue extends string>(
  descriptor: Omit<ModeDescriptor, "options"> & {
    options: readonly DisplayOption<TValue>[];
    persist: (value: TValue) => Promise<unknown>;
  },
): ModeDescriptor {
  return {
    ...descriptor,
    options: descriptor.options.map((option) => ({
      id: option.value,
      label: option.label,
      persist: () => descriptor.persist(option.value),
    })),
  };
}

function createCollectionCommands(
  descriptors: readonly ModeDescriptor[],
): QuickActionRegistration[] {
  return descriptors.map((descriptor) => ({
    configuration: "unbound",
    execute: () => undefined,
    group: "Library",
    id: descriptor.commandId,
    keywords: ["collection", "display", ...descriptor.options.map((option) => option.label)],
    label: descriptor.label,
    order: descriptor.order,
    runInPalette: () => ({
      kind: "child-mode",
      mode: new QuickActionChildModeSession({
        confirm: async (option) => {
          const selected = descriptor.options.find((candidate) => candidate.id === option.id);
          if (!selected) {
            return {
              error: "The collection display setting could not be changed. Try again.",
              kind: "keep-open",
            };
          }

          try {
            await selected.persist();
            return { kind: "close" };
          } catch {
            return {
              error: `The ${descriptor.settingLabel} is ${selected.label} for this session but could not be saved. Retry to keep this setting after Archeion closes.`,
              kind: "keep-open",
            };
          }
        },
        id: descriptor.commandId,
        placeholder: descriptor.label,
        snapshot: {
          committedOptionId: descriptor.currentValue,
          initialActiveOptionId: descriptor.currentValue,
          options: descriptor.options.map((option) => ({ id: option.id, label: option.label })),
        },
        title: descriptor.label.replace(/…$/, ""),
      }),
    }),
    scope: "library",
  }));
}
