import { BookOpenText, Check, Flag, Hash, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Input } from "../../components/Input";
import type {
  ReaderChapter,
  ReaderLandmark,
  ReaderNavigationItem,
  ReaderNavigationState,
  ReaderPageReference,
} from "../../types/reader";
import { READER_CONTENTS_SEARCH_THRESHOLD } from "./readerNavigation";
import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderNavigationCollection = "contents" | "landmarks" | "pages";

type ReaderNavigationPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onNavigate: (itemId: string) => Promise<boolean>;
};

const COLLECTION_LABELS: Readonly<Record<ReaderNavigationCollection, string>> = Object.freeze({
  contents: "Contents",
  landmarks: "Landmarks",
  pages: "Pages",
});

export function ReaderNavigationPanel({
  navigation,
  onClose,
  onNavigate,
}: ReaderNavigationPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentChapterRef = useRef<HTMLButtonElement>(null);
  const didFocusRef = useRef(false);
  const [query, setQuery] = useState("");
  const [navigatingId, setNavigatingId] = useState<string>();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const availableCollections = availableNavigationCollections(navigation);
  const [requestedCollection, setRequestedCollection] = useState<ReaderNavigationCollection>(
    () => availableCollections[0] ?? "contents",
  );
  const activeCollection = availableCollections.includes(requestedCollection)
    ? requestedCollection
    : (availableCollections[0] ?? "contents");
  const showSearch =
    activeCollection === "contents" &&
    navigation.chapters.length > READER_CONTENTS_SEARCH_THRESHOLD;
  const visibleChapters = useMemo(
    () => filterChapters(navigation.chapters, query),
    [navigation.chapters, query],
  );

  useEffect(() => {
    if (navigation.status === "loading" || didFocusRef.current) return;
    didFocusRef.current = true;
    const focusTarget = showSearch
      ? searchRef.current
      : activeCollection === "contents"
        ? (currentChapterRef.current ?? panelRef.current)
        : panelRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [activeCollection, navigation.status, showSearch]);

  useEffect(() => {
    if (activeCollection !== "contents" || !bodyRef.current || !currentChapterRef.current) {
      return;
    }
    revealWithinScrollContainer(bodyRef.current, currentChapterRef.current);
  }, [activeCollection, navigation.currentChapterId, navigation.status, visibleChapters]);

  async function selectItem(item: ReaderNavigationItem) {
    if (navigatingId) return;

    if (activeCollection === "contents" && item.id === navigation.currentChapterId) {
      onClose();
      return;
    }

    setNavigatingId(item.id);
    setNavigationFailed(false);
    const didNavigate = await onNavigate(item.id);

    if (didNavigate) {
      onClose();
      return;
    }

    setNavigatingId(undefined);
    setNavigationFailed(true);
  }

  const singleCollectionTitle =
    availableCollections.length === 1 ? COLLECTION_LABELS[availableCollections[0]!] : "Navigation";

  return (
    <ReaderSidePanel
      accessibleLabel="Book navigation"
      className="reader-navigation"
      closeLabel="Close book navigation"
      eyebrow="Navigate"
      id="reader-publication-navigation"
      ignoreReaderShortcuts
      onClose={onClose}
      ref={panelRef}
      tabIndex={-1}
      title={singleCollectionTitle}
    >
      {navigation.status === "ready" && availableCollections.length > 1 ? (
        <div aria-label="Book navigation collections" className="reader-navigation__collections">
          {availableCollections.map((collection) => (
            <button
              aria-pressed={activeCollection === collection}
              className="reader-navigation__collection"
              key={collection}
              onClick={() => {
                setRequestedCollection(collection);
                setNavigationFailed(false);
              }}
              type="button"
            >
              {COLLECTION_LABELS[collection]}
            </button>
          ))}
        </div>
      ) : null}

      {showSearch ? (
        <Input
          className="reader-navigation__search"
          icon={<Search aria-hidden="true" />}
          label="Search chapters"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search chapters"
          ref={searchRef}
          size="standard"
          type="search"
          value={query}
        />
      ) : null}

      <div className="reader-panel-scroll reader-navigation__body" ref={bodyRef}>
        {navigation.status === "loading" ? <NavigationLoadingState /> : null}

        {navigation.status === "ready" && availableCollections.length === 0 ? (
          <div className="reader-panel-empty reader-navigation__empty">
            <BookOpenText aria-hidden="true" size={28} strokeWidth={1.5} />
            <p>No book navigation</p>
            <span>
              This book does not include usable Contents, Landmarks, or Page List entries.
            </span>
          </div>
        ) : null}

        {navigation.status === "ready" &&
        availableCollections.includes("contents") &&
        activeCollection === "contents" ? (
          <ContentsCollection
            chapters={visibleChapters}
            currentChapterId={navigation.currentChapterId}
            navigatingId={navigatingId}
            onClearSearch={() => setQuery("")}
            onSelect={selectItem}
            currentChapterRef={currentChapterRef}
          />
        ) : null}

        {navigation.status === "ready" && activeCollection === "landmarks" ? (
          <LandmarksCollection
            landmarks={navigation.landmarks}
            navigatingId={navigatingId}
            onSelect={selectItem}
          />
        ) : null}

        {navigation.status === "ready" && activeCollection === "pages" ? (
          <PagesCollection
            pageReferences={navigation.pageReferences}
            navigatingId={navigatingId}
            onSelect={selectItem}
          />
        ) : null}
      </div>

      {navigationFailed ? (
        <p className="reader-panel-error reader-navigation__error" data-tone="error" role="alert">
          That destination could not be opened.
        </p>
      ) : null}
    </ReaderSidePanel>
  );
}

function ContentsCollection({
  chapters,
  currentChapterId,
  currentChapterRef,
  navigatingId,
  onClearSearch,
  onSelect,
}: {
  chapters: readonly ReaderChapter[];
  currentChapterId?: string;
  currentChapterRef: React.RefObject<HTMLButtonElement | null>;
  navigatingId?: string;
  onClearSearch: () => void;
  onSelect: (item: ReaderNavigationItem) => Promise<void>;
}) {
  if (chapters.length === 0) {
    return (
      <div className="reader-navigation__no-results">
        <p>No matching chapters</p>
        <button onClick={onClearSearch} type="button">
          Clear search
        </button>
      </div>
    );
  }

  return (
    <nav
      aria-label="Book chapters"
      className="reader-navigation__chapters"
      id="reader-navigation-contents"
    >
      {chapters.map((chapter) => {
        const isCurrent = chapter.id === currentChapterId;
        const isNavigating = chapter.id === navigatingId;

        return (
          <button
            aria-current={isCurrent ? "location" : undefined}
            className="reader-navigation__item reader-navigation__chapter"
            data-current={isCurrent || undefined}
            disabled={navigatingId !== undefined}
            key={chapter.id}
            onClick={() => void onSelect(chapter)}
            ref={isCurrent ? currentChapterRef : undefined}
            style={
              {
                "--chapter-indent": `${Math.min(chapter.depth, 6) * 18}px`,
              } as CSSProperties
            }
            type="button"
          >
            <span className="reader-navigation__item-label">{chapter.label}</span>
            {isCurrent ? (
              <Check aria-hidden="true" className="reader-navigation__current-icon" size={14} />
            ) : null}
            {isNavigating ? <span className="sr-only">Opening</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

function LandmarksCollection({
  landmarks,
  navigatingId,
  onSelect,
}: {
  landmarks: readonly ReaderLandmark[];
  navigatingId?: string;
  onSelect: (item: ReaderNavigationItem) => Promise<void>;
}) {
  return (
    <nav
      aria-label="Book landmarks"
      className="reader-navigation__items"
      id="reader-navigation-landmarks"
    >
      {landmarks.map((landmark) => (
        <button
          className="reader-navigation__item"
          disabled={navigatingId !== undefined}
          key={landmark.id}
          onClick={() => void onSelect(landmark)}
          type="button"
        >
          <span aria-hidden="true" className="reader-navigation__item-icon">
            <Flag size={14} />
          </span>
          <span className="reader-navigation__item-copy">
            <span className="reader-navigation__item-label">{landmark.label}</span>
            {landmark.semanticType ? (
              <span className="reader-navigation__item-meta">{landmark.semanticType}</span>
            ) : null}
          </span>
          {landmark.id === navigatingId ? <span className="sr-only">Opening</span> : null}
        </button>
      ))}
    </nav>
  );
}

function PagesCollection({
  pageReferences,
  navigatingId,
  onSelect,
}: {
  pageReferences: readonly ReaderPageReference[];
  navigatingId?: string;
  onSelect: (item: ReaderNavigationItem) => Promise<void>;
}) {
  return (
    <nav
      aria-label="Book pages"
      className="reader-navigation__items reader-navigation__pages"
      id="reader-navigation-pages"
    >
      {pageReferences.map((pageReference) => (
        <button
          className="reader-navigation__item"
          disabled={navigatingId !== undefined}
          key={pageReference.id}
          onClick={() => void onSelect(pageReference)}
          type="button"
        >
          <span aria-hidden="true" className="reader-navigation__item-icon">
            <Hash size={14} />
          </span>
          <span className="reader-navigation__item-label">{pageReference.label}</span>
          {pageReference.id === navigatingId ? <span className="sr-only">Opening</span> : null}
        </button>
      ))}
    </nav>
  );
}

function availableNavigationCollections(
  navigation: ReaderNavigationState,
): ReaderNavigationCollection[] {
  if (navigation.status !== "ready") return [];

  const collections: ReaderNavigationCollection[] = [];
  if (navigation.chapters.length > 0) collections.push("contents");
  if (navigation.landmarks.length > 0) collections.push("landmarks");
  if (navigation.pageReferences.length > 0) collections.push("pages");
  return collections;
}

function revealWithinScrollContainer(container: HTMLElement, target: HTMLElement): void {
  const containerBounds = container.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  let nextScrollTop = container.scrollTop;

  if (targetBounds.top < containerBounds.top) {
    nextScrollTop -= containerBounds.top - targetBounds.top;
  } else if (targetBounds.bottom > containerBounds.bottom) {
    nextScrollTop += targetBounds.bottom - containerBounds.bottom;
  }

  container.scrollTop = Math.max(0, nextScrollTop);
}

function NavigationLoadingState() {
  return (
    <div aria-label="Loading book navigation" className="reader-panel-loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function filterChapters(chapters: readonly ReaderChapter[], query: string): ReaderChapter[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) return [...chapters];

  return chapters.filter((chapter) => chapter.label.toLocaleLowerCase().includes(normalizedQuery));
}
