// @vitest-environment happy-dom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DictionaryLookupResponse, InstalledDictionary } from "../../types/dictionary";
import { createDictionaryRegistryStore } from "../../storage/dictionaryRegistryStore";
import type { DictionaryLookupCommandClient } from "../../storage/dictionaryLookupCommandClient";
import { createReaderSessionController, type ReaderSessionIdentity } from "./readerSession";
import type { HighlightInteractionMenu } from "./useHighlightPaletteController";
import {
  normalizeReaderDictionaryTerm,
  useReaderDictionaryLookup,
} from "./useReaderDictionaryLookup";

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function dictionary(overrides: Partial<InstalledDictionary> = {}): InstalledDictionary {
  return {
    catalogId: null,
    displayName: "Local Dictionary",
    enabled: true,
    entryCount: 10,
    id: "dict-a",
    indexState: "ready",
    installedSizeBytes: 1024,
    language: "English",
    licenseName: "Test license",
    licenseUrl: null,
    order: 0,
    packageVersion: "1",
    sourceAttribution: "Test source",
    sourceKind: "manual-import",
    storageRelativePath: "installed/dict-a",
    ...overrides,
  };
}

function registry(dictionaries: readonly InstalledDictionary[]) {
  return { dictionaries, recovery: null, status: "ready" as const };
}

function sessionIdentity(bookId: string): ReaderSessionIdentity {
  return createReaderSessionController(bookId).getSnapshot().lifecycle.identity!;
}

function menu(selectedText: string, cfiRange = "epubcfi(/6/2)"): HighlightInteractionMenu {
  return {
    anchor: {
      document,
      resolveRect: () => ({ bottom: 20, height: 10, left: 0, right: 20, top: 10, width: 20 }),
    },
    anchorRect: { bottom: 20, height: 10, left: 0, right: 20, top: 10, width: 20 },
    selection: { cfiRange, selectedText },
  };
}

function response(term: string): DictionaryLookupResponse {
  return {
    entries: [
      {
        definitionTextBlocks: ["A definition"],
        dictionaryId: "dict-a",
        dictionaryName: "Local Dictionary",
        displayHeadword: term,
        sourceAttribution: "Test source",
      },
    ],
    normalizedQuery: normalizeReaderDictionaryTerm(term) ?? "",
    truncated: false,
  };
}

type Controller = ReturnType<typeof useReaderDictionaryLookup>;

function Harness({
  lookupClient,
  onController,
  onManageDictionaries,
  owner,
  registrySource,
  session,
}: {
  lookupClient: DictionaryLookupCommandClient;
  onController: (controller: Controller) => void;
  onManageDictionaries: () => void;
  owner: HighlightInteractionMenu | null;
  registrySource: ReturnType<typeof createDictionaryRegistryStore>;
  session: ReaderSessionIdentity;
}) {
  const controller = useReaderDictionaryLookup({
    dependencies: { lookupClient, registrySource },
    onManageDictionaries,
    selectionOwner: owner,
    sessionIdentity: session,
  });
  useLayoutEffect(() => onController(controller), [controller, onController]);
  return null;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderLookup({
  dictionaries = [dictionary()],
  lookup = vi.fn(async (term: string) => response(term)),
  owner = menu("Example"),
  session = sessionIdentity("book-a"),
}: {
  dictionaries?: readonly InstalledDictionary[];
  lookup?: DictionaryLookupCommandClient["lookup"];
  owner?: HighlightInteractionMenu | null;
  session?: ReaderSessionIdentity;
} = {}) {
  const registrySource = createDictionaryRegistryStore({
    list: vi.fn(async () => registry(dictionaries)),
  });
  const onManageDictionaries = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  let latest!: Controller;
  const render = (nextOwner = owner, nextSession = session) => {
    act(() => {
      root.render(
        <Harness
          lookupClient={{ lookup }}
          onController={(controller) => {
            latest = controller;
          }}
          onManageDictionaries={onManageDictionaries}
          owner={nextOwner}
          registrySource={registrySource}
          session={nextSession}
        />,
      );
    });
  };
  render();
  await act(async () => Promise.resolve());
  return {
    latest: () => latest,
    lookup: vi.mocked(lookup),
    onManageDictionaries,
    registrySource,
    render,
  };
}

describe("useReaderDictionaryLookup", () => {
  it("uses the current selection text and publishes current local results", async () => {
    const selected = menu("  “Example phrase!”  ");
    const harness = await renderLookup({ owner: selected });

    expect(normalizeReaderDictionaryTerm(selected.selection.selectedText)).toBe("example phrase");
    expect(harness.latest().availabilityFor(selected.selection.selectedText).action).toBe("define");

    act(() => harness.latest().define(selected));
    expect(harness.latest().state.status).toBe("looking-up");
    await act(async () => Promise.resolve());

    expect(harness.lookup).toHaveBeenCalledWith(selected.selection.selectedText);
    expect(harness.latest().state.status).toBe("ready");
    expect(harness.latest().state.selectedTerm).toBe("example phrase");
    expect(harness.latest().state.selectionOwner).toBe(selected);
    expect(harness.latest().state.results[0]?.definitionTextBlocks).toEqual(["A definition"]);
  });

  it("publishes only the newest Define request for the same selection", async () => {
    const first = deferred<DictionaryLookupResponse>();
    const second = deferred<DictionaryLookupResponse>();
    const lookup = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const selected = menu("Example");
    const harness = await renderLookup({ lookup, owner: selected });

    act(() => {
      harness.latest().define(selected);
      harness.latest().define(selected);
    });
    await act(async () => second.resolve(response("Newest")));
    await act(async () => first.resolve(response("Older")));

    expect(harness.latest().state.selectedTerm).toBe("newest");
    expect(harness.latest().state.requestRevision).toBe(2);
  });

  it("retains selection ownership after the highlight palette yields to the definition surface", async () => {
    const selected = menu("Example");
    const harness = await renderLookup({ owner: selected });

    act(() => harness.latest().define(selected));
    harness.render(null);
    await act(async () => Promise.resolve());

    expect(harness.latest().state).toMatchObject({
      selectedTerm: "example",
      selectionOwner: selected,
      status: "ready",
    });
    act(() => harness.latest().dismiss());
    expect(harness.latest().state.status).toBe("idle");
  });

  it("keeps invalid selections unavailable without starting lookup", async () => {
    const harness = await renderLookup();
    const empty = menu("... ");
    const oversized = menu("a".repeat(257));

    expect(harness.latest().availabilityFor(empty.selection.selectedText).available).toBe(false);
    expect(harness.latest().availabilityFor(oversized.selection.selectedText).available).toBe(
      false,
    );
    act(() => {
      harness.latest().define(empty);
      harness.latest().define(oversized);
    });

    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.latest().state.status).toBe("idle");
  });

  it("opens dictionary management instead of lookup when no current dictionary is enabled", async () => {
    const selected = menu("Example");
    const focusTarget = document.body.appendChild(document.createElement("button"));
    selected.anchor.focusTarget = focusTarget;
    const harness = await renderLookup({ dictionaries: [dictionary({ enabled: false })] });

    expect(harness.latest().availabilityFor(selected.selection.selectedText)).toMatchObject({
      action: "manage-dictionaries",
      available: true,
      label: "Manage dictionaries",
    });
    act(() => harness.latest().define(selected));

    expect(harness.onManageDictionaries).toHaveBeenCalledWith(focusTarget);
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it("distinguishes no results from a recoverable current lookup error", async () => {
    const selected = menu("Unknown");
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ entries: [], normalizedQuery: "unknown", truncated: false })
      .mockRejectedValueOnce(new Error("Dictionary data is unavailable"));
    const harness = await renderLookup({ lookup, owner: selected });

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    expect(harness.latest().state.status).toBe("no-results");

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    expect(harness.latest().state).toMatchObject({
      error: "Dictionary data is unavailable",
      status: "error",
    });
  });

  it("retries the current failed selection with a new request revision", async () => {
    const retryResult = deferred<DictionaryLookupResponse>();
    const selected = menu("Example");
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error("Dictionary data is unavailable"))
      .mockImplementationOnce(() => retryResult.promise);
    const harness = await renderLookup({ lookup, owner: selected });

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    expect(harness.latest().state.status).toBe("error");

    act(() => harness.latest().retry());
    expect(harness.latest().state).toMatchObject({ requestRevision: 2, status: "looking-up" });
    await act(async () => retryResult.resolve(response("Example")));

    expect(harness.latest().state).toMatchObject({
      requestRevision: 2,
      selectedTerm: "example",
      status: "ready",
    });
  });

  it("retires the owned lookup when its content document is removed or selection collapses", async () => {
    const selected = menu("Example");
    const harness = await renderLookup({ owner: selected });

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    act(() => harness.latest().handleSelectionCollapsed(selected.anchor.document));
    expect(harness.latest().state.status).toBe("idle");

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    act(() => harness.latest().handleDocumentRemoved(selected.anchor.document));
    expect(harness.latest().state.status).toBe("idle");
  });

  it("retires an older completion after selection or Reader session replacement", async () => {
    const pending = deferred<DictionaryLookupResponse>();
    const first = menu("First", "epubcfi(/6/2)");
    const second = menu("Second", "epubcfi(/6/4)");
    const harness = await renderLookup({ lookup: vi.fn(() => pending.promise), owner: first });

    act(() => harness.latest().define(first));
    harness.render(second);
    expect(harness.latest().state.status).toBe("idle");

    await act(async () => pending.resolve(response("First")));
    expect(harness.latest().state.status).toBe("idle");

    const nextPending = deferred<DictionaryLookupResponse>();
    harness.lookup.mockImplementationOnce(() => nextPending.promise);
    act(() => harness.latest().define(second));
    harness.render(second, sessionIdentity("book-b"));
    await act(async () => nextPending.resolve(response("Second")));

    expect(harness.latest().state.status).toBe("idle");
    expect(harness.latest().state.results).toEqual([]);
  });

  it("retires current lookup when installed dictionary availability changes", async () => {
    const selected = menu("Example");
    const harness = await renderLookup({ owner: selected });

    act(() => harness.latest().define(selected));
    await act(async () => Promise.resolve());
    expect(harness.latest().state.status).toBe("ready");

    act(() => harness.registrySource.publish(registry([dictionary({ enabled: false })])));

    expect(harness.latest().state.status).toBe("idle");
    expect(harness.latest().availabilityFor(selected.selection.selectedText).action).toBe(
      "manage-dictionaries",
    );
  });
});
