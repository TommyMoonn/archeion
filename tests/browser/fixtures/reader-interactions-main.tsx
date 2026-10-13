import { createRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import EpubCFI from "epubjs/src/epubcfi.js";
import { mockIPC } from "@tauri-apps/api/mocks";
import { EpubViewer, type EpubViewerHandle } from "../../../src/features/reader/EpubViewer";
import { createReaderFileLease } from "../../../src/features/reader/readerFileLease";
import { createReaderSessionController } from "../../../src/features/reader/readerSession";
import { createReaderContentTheme } from "../../../src/features/reader/readerTheme";
import { resolveBuiltInReaderTheme } from "../../../src/themes/resolveTheme";
import { defaultReaderSettings, type ReaderNavigationState } from "../../../src/types/reader";
import type { BookmarkAnnotation, HighlightAnnotation } from "../../../src/types/annotation";
import { dictionaryRegistryStore } from "../../../src/storage/dictionaryRegistryStore";
import {
  buildReaderFixture,
  readerFixtures,
  type ReaderFixtureId,
} from "../../fixtures/reader/readerFixtures";
import { probeReaderDocumentListeners } from "./reader-document-listener-probe";
import "../../../src/styles/index.css";

const probe = probeReaderDocumentListeners();
dictionaryRegistryStore.publish({
  status: "ready",
  recovery: null,
  dictionaries: [
    {
      id: "synthetic",
      displayName: "Synthetic dictionary",
      sourceLanguage: "en",
      targetLanguage: "en",
      enabled: true,
      order: 0,
      entryCount: 1,
      installedSizeBytes: 1,
      sourceKind: "manual-import",
      catalogId: null,
      sourceAttribution: "Original fixture",
      licenseName: "Fixture",
      licenseUrl: null,
      packageVersion: "1",
      indexState: "ready",
      storageRelativePath: "synthetic",
    },
  ],
});
let finishLookup: (() => void) | undefined;
let holdLookup = false;
mockIPC(async (command, args) => {
  if (command !== "lookup_dictionary_term") throw new Error(`Unexpected fixture IPC: ${command}`);
  if (holdLookup)
    await new Promise<void>((resolve) => {
      finishLookup = resolve;
    });
  const term = String((args as { term: string }).term);
  return {
    normalizedQuery: term,
    truncated: false,
    entries: [
      {
        dictionaryId: "synthetic",
        dictionaryName: "Synthetic dictionary",
        displayHeadword: term,
        definitionTextBlocks: ["Original synthetic definition"],
        sourceAttribution: "Original fixture",
      },
    ],
  };
});

const root = createRoot(document.getElementById("root")!);
const viewer = createRef<EpubViewerHandle>();
let fixtureId: ReaderFixtureId = "long-spine";
let lease: ReturnType<typeof createReaderFileLease> | undefined;
let highlights: HighlightAnnotation[] = [];
let props: ComponentProps<typeof EpubViewer>;
function render() {
  flushSync(() => root.render(<EpubViewer {...props} highlights={highlights} ref={viewer} />));
}
let ready = false;
let errors: string[] = [];
let keys = 0;
let note: string | null = null;
let mode: "continuous" | "paged" = "continuous";
let sequence = 0;
let navigation: ReaderNavigationState | undefined;

function mountedElement(id: string) {
  for (const frame of document.querySelectorAll(".epub-viewer iframe")) {
    const element = (frame as HTMLIFrameElement).contentDocument?.getElementById(id);
    if (element) return element;
  }
  throw new Error(`Synthetic anchor is not mounted: ${id}`);
}
function cfi(id: string) {
  const element = mountedElement(id);
  const fixture = readerFixtures.find((entry) => entry.id === fixtureId)!;
  const index = fixture.sections.findIndex((section) => section.id === element.ownerDocument.title);
  if (index < 0) throw new Error("Missing synthetic section identity");
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element.firstChild ?? element);
  return new EpubCFI(
    range,
    `/6/${(index + 1) * 2}[${fixture.sections[index].id}]`,
    "archeion-highlight",
  ).toString();
}
async function open(id: ReaderFixtureId, nextMode = mode, archive = "archive-a") {
  ready = false;
  navigation = undefined;
  errors = [];
  note = null;
  fixtureId = id;
  mode = nextMode;
  // Reuse the component so book/archive/mode supersession exercises production effects.
  lease?.dispose();
  const bytes = await buildReaderFixture(id);
  const blob = new Blob([bytes as BlobPart], { type: "application/epub+zip" });
  lease = createReaderFileLease({
    initialBlob: blob,
    load: async () => blob,
    requestKey: `${archive}:${id}:${sequence++}`,
  });
  const identity = createReaderSessionController(`${archive}:${id}:${sequence}`).getSnapshot()
    .lifecycle.identity!;
  const theme = resolveBuiltInReaderTheme("dark");
  const settings = { ...defaultReaderSettings, mode };
  highlights = [];
  props = {
    contentTheme: createReaderContentTheme(settings, theme.tokens),
    fileLease: lease,
    publicationLayoutCapability: null,
    onError: (_identity, error) => errors.push(error.kind),
    onKeyDown: () => keys++,
    onLocationChange: () => undefined,
    onPublicationLayoutCapability: () => undefined,
    onReady: () => {
      ready = true;
    },
    onNavigationChange: (next) => {
      navigation = next;
    },
    readerTheme: theme,
    settings,
    sessionIdentity: identity,
    onOpenNote: (_selection, highlight) => {
      note = highlight?.id ?? "new-note";
    },
  };
  render();
}

declare global {
  interface Window {
    readerInteractions: {
      open: typeof open;
      ready: () => boolean;
      errors: () => string[];
      navigate: (target: string) => Promise<boolean>;
      cfi: typeof cfi;
      saveHighlight: (id: string) => HighlightAnnotation;
      bookmark: (id: string) => BookmarkAnnotation;
      followBookmark: (bookmark: BookmarkAnnotation) => Promise<boolean>;
      search: (query: string) => void;
      searchState: () => ReturnType<EpubViewerHandle["getPublicationSearchState"]>;
      followSearch: (id: string) => Promise<boolean>;
      metrics: () => ReturnType<typeof probe.snapshot>;
      keys: () => number;
      note: () => string | null;
      holdDictionary: () => void;
      finishDictionary: () => void;
      dispose: () => void;
    };
  }
}
window.readerInteractions = {
  open,
  ready: () => ready && navigation?.status === "ready",
  errors: () => errors,
  navigate: (target) => {
    if (target.startsWith("epubcfi(")) return viewer.current!.navigateToLocation(target);
    const item = navigation?.chapters.find((chapter) => chapter.label === target);
    if (!item) throw new Error("Unknown synthetic section");
    return viewer.current!.navigateToChapter(item.id);
  },
  cfi,
  saveHighlight: (id) => {
    const element = mountedElement(id);
    const timestamp = "2026-01-01T00:00:00Z";
    const highlight: HighlightAnnotation = {
      type: "highlight",
      id: "saved-highlight",
      cfiRange: cfi(id),
      chapterHref: `${element.ownerDocument.title}.xhtml`,
      selectedText: element.textContent!,
      color: "yellow",
      note: "Original saved note",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    highlights = [highlight];
    render();
    return highlight;
  },
  bookmark: (id) => ({
    type: "bookmark",
    id: "saved-bookmark",
    cfiRange: cfi(id),
    chapterHref: `${mountedElement(id).ownerDocument.title}.xhtml`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  followBookmark: async (bookmark) => {
    const result = await viewer.current!.resolveAnnotationAnchor(bookmark, false);
    return result.kind === "resolved" && viewer.current!.navigateToLocation(result.cfiRange);
  },
  search: (query) => viewer.current!.setPublicationSearchQuery(query),
  searchState: () => viewer.current!.getPublicationSearchState(),
  followSearch: (id) => viewer.current!.navigateToPublicationSearchResult(id),
  metrics: probe.snapshot,
  keys: () => keys,
  note: () => note,
  holdDictionary: () => {
    holdLookup = true;
  },
  finishDictionary: () => {
    holdLookup = false;
    finishLookup?.();
    finishLookup = undefined;
  },
  dispose: () => {
    flushSync(() => root.render(null));
    lease?.dispose();
    ready = false;
  },
};
await open("long-spine");
