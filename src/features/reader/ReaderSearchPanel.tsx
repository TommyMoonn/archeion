import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import type { ReaderPublicationSearchResult } from "./readerPublicationSearch";
import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";
import { ReaderSidePanel } from "./ReaderSidePanel";

type ReaderSearchPanelProps = {
  inputRef?: RefObject<HTMLInputElement | null>;
  onActivateResult: (resultId: string) => Promise<boolean>;
  onClose: () => void;
  onNextResult: () => Promise<boolean>;
  onPreviousResult: () => Promise<boolean>;
  onQueryChange: (query: string) => void;
  state: ReaderPublicationSearchControllerState;
};

export function ReaderSearchPanel({
  inputRef,
  onActivateResult,
  onClose,
  onNextResult,
  onPreviousResult,
  onQueryChange,
  state,
}: ReaderSearchPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const queryInputRef = inputRef ?? localInputRef;
  const hasResults = state.status === "ready" && state.results.length > 0;

  useLayoutEffect(() => {
    (inputRef?.current ?? localInputRef.current ?? panelRef.current)?.focus({
      preventScroll: true,
    });
  }, [inputRef]);

  function handleQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key !== "Enter" ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      !hasResults
    ) {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) void onPreviousResult();
    else void onNextResult();
  }

  return (
    <ReaderSidePanel
      accessibleLabel="Find in book"
      ariaBusy={state.status === "searching"}
      className="reader-search"
      closeLabel="Close Find in Book"
      eyebrow="Search"
      headerActions={
        <>
          <IconButton
            disabled={!hasResults}
            disabledReason="No search result to navigate"
            label="Previous match"
            onClick={() => void onPreviousResult()}
            size="compact"
            tooltip={hasResults ? "Previous match" : "No search result to navigate"}
          >
            <ChevronUp aria-hidden="true" />
          </IconButton>
          <IconButton
            disabled={!hasResults}
            disabledReason="No search result to navigate"
            label="Next match"
            onClick={() => void onNextResult()}
            size="compact"
            tooltip={hasResults ? "Next match" : "No search result to navigate"}
          >
            <ChevronDown aria-hidden="true" />
          </IconButton>
        </>
      }
      id="reader-find-in-book"
      ignoreReaderShortcuts
      onClose={onClose}
      ref={panelRef}
      tabIndex={-1}
      title="Find in Book"
    >
      <div className="reader-search__controls">
        <Input
          className="reader-search__input"
          icon={<Search aria-hidden="true" />}
          label="Find text in book"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={handleQueryKeyDown}
          placeholder="Find text in book"
          ref={queryInputRef}
          size="standard"
          type="search"
          value={state.query}
        />
        <SearchStatus state={state} />
      </div>

      <div className="reader-search__body">
        {state.status === "idle" && !state.query.trim() ? (
          <div className="reader-search__empty">
            <Search aria-hidden="true" size={28} strokeWidth={1.5} />
            <p>Search this book</p>
            <span>Enter a word or phrase to find it in the active EPUB.</span>
          </div>
        ) : null}

        {state.status === "searching" ? <SearchLoadingState /> : null}

        {state.status === "ready" && state.results.length === 0 ? (
          <div className="reader-search__empty">
            <p>No matches found</p>
            <span>Try a different word or phrase.</span>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="reader-search__empty" role="alert">
            <p>Search could not be completed</p>
            <span>You can edit the query or try the current search again.</span>
            <Button onClick={() => onQueryChange(state.query)} size="standard" variant="secondary">
              Try again
            </Button>
          </div>
        ) : null}

        {hasResults ? (
          <ol aria-label="Search results" className="reader-search__results">
            {state.results.map((result) => (
              <SearchResult
                active={state.selectedResult?.id === result.id}
                key={result.id}
                onActivate={() => void onActivateResult(result.id)}
                result={result}
              />
            ))}
          </ol>
        ) : null}
      </div>
    </ReaderSidePanel>
  );
}

function SearchStatus({ state }: { state: ReaderPublicationSearchControllerState }) {
  let text = "";
  if (state.status === "searching") {
    text = "Searching…";
  } else if (state.status === "ready") {
    const noun = state.results.length === 1 ? "match" : "matches";
    text = state.truncated
      ? `${state.results.length} ${noun} shown · More matches available`
      : `${state.results.length} ${noun}`;
  } else if (state.status === "error") {
    text = "Search unavailable";
  }

  return (
    <p aria-live="polite" className="reader-search__status" role="status">
      {text}
    </p>
  );
}

function SearchResult({
  active,
  onActivate,
  result,
}: {
  active: boolean;
  onActivate: () => void;
  result: ReaderPublicationSearchResult;
}) {
  return (
    <li className="reader-search__result" data-active={active || undefined}>
      <button aria-current={active ? "true" : undefined} onClick={onActivate} type="button">
        <span className="reader-search__result-meta">
          {result.chapterLabel ?? `Section ${result.position.spineIndex + 1}`}
        </span>
        <span className="reader-search__result-excerpt">{result.excerpt}</span>
        {active ? <span className="sr-only">Active result</span> : null}
      </button>
    </li>
  );
}

function SearchLoadingState() {
  return (
    <div aria-label="Searching book" className="reader-search__loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}
