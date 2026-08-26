import { X } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
import type { DictionaryDefinitionEntry } from "../../types/dictionary";
import { placeReaderAnchoredPopover, readerViewportRect } from "./readerContentActionAnchor";
import type { ClientRect, HighlightPaletteAnchor } from "./readerHighlightPaletteAnchor";
import { trapReaderPopoverFocus } from "./readerPopoverFocus";
import { useReaderSideSurfaceDismiss } from "./readerSideSurfaceDismissal";
import type { ReaderDictionaryLookupState } from "./useReaderDictionaryLookup";

type ReaderDictionaryPopoverProps = Readonly<{
  anchor: HighlightPaletteAnchor;
  initialAnchorRect: ClientRect;
  onDismiss: () => void;
  onRetry: () => void;
  state: ReaderDictionaryLookupState;
  viewerRef: RefObject<HTMLElement | null>;
}>;

type DictionaryResultGroup = Readonly<{
  dictionaryId: string;
  dictionaryName: string;
  entries: readonly DictionaryDefinitionEntry[];
  sourceAttribution: string;
}>;

const DICTIONARY_POPOVER_PREFERENCES = {
  maxHeight: 520,
  width: 440,
} as const;

function groupDictionaryResults(
  entries: readonly DictionaryDefinitionEntry[],
): readonly DictionaryResultGroup[] {
  const groups = new Map<string, DictionaryDefinitionEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.dictionaryId);
    if (group) group.push(entry);
    else groups.set(entry.dictionaryId, [entry]);
  }
  return [...groups.values()].map((group) => ({
    dictionaryId: group[0]!.dictionaryId,
    dictionaryName: group[0]!.dictionaryName,
    entries: group,
    sourceAttribution: group[0]!.sourceAttribution,
  }));
}

function normalizeDisplayHeadword(headword: string): string {
  return headword.toLowerCase();
}

export function ReaderDictionaryPopover({
  anchor,
  initialAnchorRect,
  onDismiss,
  onRetry,
  state,
  viewerRef,
}: ReaderDictionaryPopoverProps) {
  const titleId = useId();
  const popoverRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState(initialAnchorRect);
  const [viewportRect, setViewportRect] = useState(() => readerViewportRect(null));
  const [size, setSize] = useState({ height: 260, width: 420 });

  const dismiss = useCallback(
    (restoreFocus = true) => {
      const closingSurface = popoverRef.current;
      const focusTarget = anchor.focusTarget;
      onDismiss();
      if (!restoreFocus || !focusTarget) return;
      window.requestAnimationFrame(() =>
        focusElementIfRestorationOwned(focusTarget, {
          closingSurface,
          invalidatedOrigin: closingSurface,
        }),
      );
    },
    [anchor.focusTarget, onDismiss],
  );
  const dismissal = useReaderSideSurfaceDismiss(
    (restoreFocus = true) => {
      dismiss(restoreFocus);
      return true;
    },
    true,
    "dictionary-definition",
  );

  useTransientSurfaceOwnership({
    closeOnModalOpen: !dismissal.readerOwned,
    dismissOnOutsidePointer: true,
    elementRef: popoverRef,
    kind: "popover",
    onDismiss: (reason) => (reason === "escape" ? dismissal.requestDismissal() : dismiss(false)),
    origin: anchor.focusTarget,
  });

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const measure = () => {
      const bounds = popover.getBoundingClientRect();
      if ([bounds.height, bounds.width].every(Number.isFinite)) {
        setSize({ height: bounds.height, width: bounds.width });
      }
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(popover);
    return () => observer?.disconnect();
  }, [state]);

  useLayoutEffect(() => {
    const refresh = () => {
      const nextAnchor = anchor.resolveRect();
      if (!nextAnchor) {
        dismiss(false);
        return;
      }
      setAnchorRect(nextAnchor);
      setViewportRect(readerViewportRect(viewerRef.current));
    };
    const sourceWindow = anchor.document.defaultView;
    refresh();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refresh);
    if (viewerRef.current) observer?.observe(viewerRef.current);
    let frame = sourceWindow?.frameElement;
    while (frame) {
      observer?.observe(frame);
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }
    const onPageHide = () => dismiss(false);
    window.addEventListener("resize", refresh);
    document.addEventListener("scroll", refresh, true);
    anchor.document.addEventListener("scroll", refresh, true);
    sourceWindow?.addEventListener("pagehide", onPageHide);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
      document.removeEventListener("scroll", refresh, true);
      anchor.document.removeEventListener("scroll", refresh, true);
      sourceWindow?.removeEventListener("pagehide", onPageHide);
    };
  }, [anchor, dismiss, viewerRef]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const placement = placeReaderAnchoredPopover(
    anchorRect,
    viewportRect,
    size,
    DICTIONARY_POPOVER_PREFERENCES,
  );
  if (!placement || !state.selectedTerm || state.status === "idle") return null;
  const groups = groupDictionaryResults(state.results);

  return (
    <aside
      ref={popoverRef}
      aria-labelledby={titleId}
      className="reader-dictionary-popover"
      data-placement={placement.placement}
      data-reader-ignore-shortcuts
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => trapReaderPopoverFocus(event, popoverRef.current)}
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      style={{
        left: placement.left,
        maxHeight: placement.maxHeight,
        top: placement.top,
        width: placement.width,
      }}
    >
      <header className="reader-dictionary-popover__header">
        <div>
          <span>Definition</span>
          <h2 id={titleId}>{state.selectedTerm}</h2>
        </div>
        <IconButton
          label="Close definition"
          onClick={() => dismissal.requestDismissal()}
          ref={closeRef}
          size="compact"
        >
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div
        aria-busy={state.status === "looking-up" || undefined}
        aria-label="Dictionary definitions"
        className="reader-dictionary-popover__content"
        role="region"
        tabIndex={0}
      >
        {state.status === "looking-up" ? (
          <p className="reader-dictionary-popover__status" role="status">
            Looking up definition…
          </p>
        ) : null}
        {state.status === "no-results" ? (
          <p className="reader-dictionary-popover__status" role="status">
            No definitions found.
          </p>
        ) : null}
        {state.status === "error" ? (
          <div className="reader-dictionary-popover__status" data-status="error" role="alert">
            <p>{state.error ?? "The definition could not be loaded."}</p>
            <Button onClick={onRetry} size="compact" variant="secondary">
              Try again
            </Button>
          </div>
        ) : null}
        {state.status === "ready"
          ? groups.map((group) => (
              <section className="reader-dictionary-popover__group" key={group.dictionaryId}>
                <header>
                  <h3>{group.dictionaryName}</h3>
                  <p>{group.sourceAttribution}</p>
                </header>
                {group.entries.map((entry, entryIndex) => {
                  const previousEntry = group.entries[entryIndex - 1];
                  const showHeadword =
                    !previousEntry ||
                    normalizeDisplayHeadword(previousEntry.displayHeadword) !==
                      normalizeDisplayHeadword(entry.displayHeadword);
                  return (
                    <article
                      className="reader-dictionary-popover__entry"
                      key={`${entry.displayHeadword}:${entryIndex}`}
                    >
                      {showHeadword ? <h4>{entry.displayHeadword}</h4> : null}
                      {entry.definitionTextBlocks.map((block, blockIndex) => (
                        <p key={blockIndex}>{block}</p>
                      ))}
                    </article>
                  );
                })}
              </section>
            ))
          : null}
        {state.status === "ready" && state.truncated ? (
          <p className="reader-dictionary-popover__truncated">
            Additional definitions were omitted to keep this lookup responsive.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
