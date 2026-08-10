import { BookOpenText, Check, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Input } from "../../components/Input";
import type { ReaderChapter, ReaderNavigationState } from "../../types/reader";
import { READER_TOC_SEARCH_THRESHOLD } from "./readerNavigation";
import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderTocPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onNavigate: (chapterId: string) => Promise<boolean>;
};

export function ReaderTocPanel({ navigation, onClose, onNavigate }: ReaderTocPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentChapterRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [navigatingId, setNavigatingId] = useState<string>();
  const [navigationFailed, setNavigationFailed] = useState(false);
  const showSearch = navigation.chapters.length > READER_TOC_SEARCH_THRESHOLD;
  const visibleChapters = useMemo(
    () => filterChapters(navigation.chapters, query),
    [navigation.chapters, query],
  );

  useEffect(() => {
    const focusTarget = showSearch
      ? searchRef.current
      : (currentChapterRef.current ?? panelRef.current);
    focusTarget?.focus({ preventScroll: true });

    if (bodyRef.current && currentChapterRef.current) {
      revealWithinScrollContainer(bodyRef.current, currentChapterRef.current);
    }
  }, [navigation.status, showSearch]);

  async function selectChapter(chapter: ReaderChapter) {
    if (navigatingId) {
      return;
    }

    if (chapter.id === navigation.currentChapterId) {
      onClose();
      return;
    }

    setNavigatingId(chapter.id);
    setNavigationFailed(false);
    const didNavigate = await onNavigate(chapter.id);

    if (didNavigate) {
      onClose();
      return;
    }

    setNavigatingId(undefined);
    setNavigationFailed(true);
  }

  return (
    <ReaderSidePanel
      accessibleLabel="Table of contents"
      className="reader-toc"
      closeLabel="Close table of contents"
      eyebrow="Navigate"
      id="reader-table-of-contents"
      ignoreReaderShortcuts
      onClose={onClose}
      ref={panelRef}
      tabIndex={-1}
      title="Contents"
    >
      {showSearch ? (
        <Input
          className="reader-toc__search"
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

      <div className="reader-toc__body" ref={bodyRef}>
        {navigation.status === "loading" ? <TocLoadingState /> : null}

        {navigation.status === "ready" && navigation.chapters.length === 0 ? (
          <div className="reader-toc__empty">
            <BookOpenText aria-hidden="true" size={28} strokeWidth={1.5} />
            <p>No table of contents</p>
            <span>This book does not include usable chapter navigation.</span>
          </div>
        ) : null}

        {navigation.status === "ready" && navigation.chapters.length > 0 ? (
          visibleChapters.length > 0 ? (
            <nav aria-label="Book chapters" className="reader-toc__chapters">
              {visibleChapters.map((chapter) => {
                const isCurrent = chapter.id === navigation.currentChapterId;
                const isNavigating = chapter.id === navigatingId;

                return (
                  <button
                    aria-current={isCurrent ? "location" : undefined}
                    className="reader-toc__chapter"
                    data-current={isCurrent || undefined}
                    disabled={navigatingId !== undefined}
                    key={chapter.id}
                    onClick={() => void selectChapter(chapter)}
                    ref={isCurrent ? currentChapterRef : undefined}
                    style={
                      {
                        "--chapter-indent": `${Math.min(chapter.depth, 6) * 18}px`,
                      } as CSSProperties
                    }
                    type="button"
                  >
                    <span className="reader-toc__chapter-label">{chapter.label}</span>
                    {isCurrent ? (
                      <Check aria-hidden="true" className="reader-toc__current-icon" size={14} />
                    ) : null}
                    {isNavigating ? <span className="sr-only">Opening</span> : null}
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="reader-toc__no-results">
              <p>No matching chapters</p>
              <button onClick={() => setQuery("")} type="button">
                Clear search
              </button>
            </div>
          )
        ) : null}
      </div>

      {navigationFailed ? (
        <p className="reader-toc__error" data-tone="error" role="alert">
          That chapter could not be opened.
        </p>
      ) : null}
    </ReaderSidePanel>
  );
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

function TocLoadingState() {
  return (
    <div aria-label="Loading table of contents" className="reader-toc__loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

function filterChapters(chapters: readonly ReaderChapter[], query: string): ReaderChapter[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...chapters];
  }

  return chapters.filter((chapter) => chapter.label.toLocaleLowerCase().includes(normalizedQuery));
}
