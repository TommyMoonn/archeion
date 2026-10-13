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
import { captureContinuousAnchor } from "../../../src/features/reader/readerContinuousAnchor";
import type { ReaderSettings } from "../../../src/types/reader";
import type { BookmarkAnnotation, HighlightAnnotation } from "../../../src/types/annotation";
import { dictionaryRegistryStore } from "../../../src/storage/dictionaryRegistryStore";
import {
  buildReaderFixture,
  readerFixtures,
  type ReaderFixtureId,
} from "../../fixtures/reader/readerFixtures";
import { probeReaderDocumentListeners } from "./reader-document-listener-probe";
import { mountWheelOverlay } from "./reader-wheel-overlays";
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
let relocations = 0;
let locationCfi: string | null = null;
let closeOverlay: (() => void) | undefined;

function passage() {
  const scroller = document.querySelector<HTMLElement>(".epub-container")!;
  const anchor = captureContinuousAnchor(scroller);
  if (!anchor?.range) throw new Error("Expected visible fixture text");
  const fixture = readerFixtures.find((entry) => entry.id === fixtureId)!;
  const index = fixture.sections.findIndex(
    (section) => section.id === anchor.element.ownerDocument.title,
  );
  return {
    cfi: new EpubCFI(
      anchor.range,
      `/6/${(index + 1) * 2}[${fixture.sections[index].id}]`,
      "archeion-highlight",
    ).toString(),
    y: anchor.y,
    text: anchor.range.toString(),
  };
}

function passageAt(target: string) {
  const parsed = new EpubCFI(target);
  const fixture = readerFixtures.find((entry) => entry.id === fixtureId)!;
  const doc = [...document.querySelectorAll<HTMLIFrameElement>(".epub-viewer iframe")]
    .map((frame) => frame.contentDocument)
    .find((candidate) => candidate?.title === fixture.sections[parsed.spinePos].id);
  if (!doc) return null;
  const range = parsed.toRange(doc, "archeion-highlight");
  if (
    range.collapsed &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.startOffset < (range.startContainer.textContent?.length ?? 0)
  ) {
    range.setEnd(range.startContainer, range.startOffset + 1);
  }
  const frame = doc.defaultView!.frameElement!;
  const scroller = document.querySelector<HTMLElement>(".epub-container")!;
  const box = range.getBoundingClientRect();
  const frameBox = frame.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  const y = frameBox.top + box.top - viewport.top;
  const x = frameBox.left + box.left - viewport.left;
  return {
    y,
    x,
    visible:
      y + box.height > 0 &&
      y < scroller.clientHeight &&
      x + box.width > 0 &&
      x < scroller.clientWidth,
    text: range.toString(),
  };
}

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
  closeOverlay?.();
  ready = false;
  relocations = 0;
  locationCfi = null;
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
    onLocationChange: (location) => {
      relocations++;
      locationCfi = location.cfi;
    },
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
      passage: typeof passage;
      passageAt: typeof passageAt;
      relocations: () => number;
      location: () => string | null;
      history: () => ReturnType<EpubViewerHandle["getNavigationHistorySnapshot"]>;
      settings: (patch: Partial<ReaderSettings>) => void;
      showOverlay: (kind: Parameters<typeof mountWheelOverlay>[0]) => void;
      closeOverlay: () => void;
      holdDictionary: () => void;
      finishDictionary: () => void;
      dispose: () => void;
    };
  }
}
window.readerInteractions = {
  open,
  passage,
  passageAt,
  relocations: () => relocations,
  location: () => locationCfi,
  showOverlay: (kind) => {
    closeOverlay?.();
    closeOverlay = mountWheelOverlay(kind);
  },
  closeOverlay: () => {
    closeOverlay?.();
    closeOverlay = undefined;
  },
  history: () => viewer.current!.getNavigationHistorySnapshot(),
  settings: (patch) => {
    const settings = { ...props.settings, ...patch };
    props = {
      ...props,
      settings,
      contentTheme: createReaderContentTheme(settings, props.readerTheme.tokens),
    };
    render();
  },
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
    closeOverlay?.();
    flushSync(() => root.render(null));
    lease?.dispose();
    ready = false;
  },
};
await open("long-spine");
