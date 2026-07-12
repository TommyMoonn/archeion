import { BookmarkSimple, Check, NotePencil, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../../components/IconButton";
import type { Annotation } from "../../types/annotation";

type ReaderBookmarksPanelProps = {
  bookmarks: readonly Annotation[];
  busy: boolean;
  currentCfi: string;
  onClose: () => void;
  onNavigate: (bookmark: Annotation) => Promise<boolean>;
  onNote: (bookmark: Annotation) => void;
  onRemove: (bookmark: Annotation) => Promise<boolean>;
  onUpdateLabel: (bookmark: Annotation, label: string) => Promise<boolean>;
};

export function ReaderBookmarksPanel({
  bookmarks,
  busy,
  currentCfi,
  onClose,
  onNavigate,
  onNote,
  onRemove,
  onUpdateLabel,
}: ReaderBookmarksPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [editingId, setEditingId] = useState<string>();
  const [draftLabel, setDraftLabel] = useState("");
  const [navigationFailed, setNavigationFailed] = useState(false);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  async function saveLabel(bookmark: Annotation) {
    const saved = await onUpdateLabel(bookmark, draftLabel);
    if (saved) setEditingId(undefined);
  }

  async function navigate(bookmark: Annotation) {
    setNavigationFailed(false);
    const didNavigate = await onNavigate(bookmark);
    if (didNavigate) {
      onClose();
    } else {
      setNavigationFailed(true);
    }
  }

  return (
    <aside
      aria-label="Bookmarks"
      className="reader-toc reader-bookmarks"
      data-reader-ignore-shortcuts
      id="reader-bookmarks"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="reader-panel-header">
        <div>
          <p>Annotations</p>
          <h2>Bookmarks</h2>
        </div>
        <IconButton label="Close bookmarks" onClick={onClose} size="compact">
          <X aria-hidden="true" />
        </IconButton>
      </header>

      <div className="reader-toc__body reader-bookmarks__body">
        {bookmarks.length === 0 ? (
          <div className="reader-toc__empty">
            <BookmarkSimple aria-hidden="true" size={28} weight="thin" />
            <p>No bookmarks</p>
            <span>Bookmark your current position from the reader toolbar.</span>
          </div>
        ) : (
          <ol className="reader-bookmarks__list">
            {bookmarks.map((bookmark, index) => {
              const isCurrent = bookmark.cfiRange === currentCfi;
              const isEditing = editingId === bookmark.id;
              const label = bookmark.label?.trim() || `Bookmark ${index + 1}`;

              return (
                <li
                  className="reader-bookmarks__item"
                  data-current={isCurrent || undefined}
                  key={bookmark.id}
                >
                  {isEditing ? (
                    <form
                      className="reader-bookmarks__edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveLabel(bookmark);
                      }}
                    >
                      <label className="sr-only" htmlFor={`bookmark-label-${bookmark.id}`}>
                        Bookmark label
                      </label>
                      <input
                        autoFocus
                        id={`bookmark-label-${bookmark.id}`}
                        maxLength={80}
                        onChange={(event) => setDraftLabel(event.currentTarget.value)}
                        value={draftLabel}
                      />
                      <IconButton
                        aria-busy={busy || undefined}
                        disabled={busy}
                        label="Save bookmark label"
                        size="compact"
                        type="submit"
                      >
                        <Check aria-hidden="true" />
                      </IconButton>
                    </form>
                  ) : (
                    <button
                      aria-current={isCurrent ? "location" : undefined}
                      className="reader-bookmarks__target"
                      disabled={busy}
                      onClick={() => void navigate(bookmark)}
                      type="button"
                    >
                      <span>{label}</span>
                      <small>{bookmark.chapterHref || "Saved location"}</small>
                    </button>
                  )}
                  <div className="reader-bookmarks__actions">
                    <IconButton
                      disabled={busy}
                      label={`Note for ${label}`}
                      onClick={() => onNote(bookmark)}
                      size="compact"
                    >
                      <NotePencil aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      disabled={busy}
                      label={`Edit ${label}`}
                      onClick={() => {
                        setDraftLabel(bookmark.label ?? "");
                        setEditingId(bookmark.id);
                      }}
                      size="compact"
                    >
                      <PencilSimple aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      disabled={busy}
                      label={`Remove ${label}`}
                      onClick={() => void onRemove(bookmark)}
                      size="compact"
                    >
                      <Trash aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {navigationFailed ? (
        <p className="reader-toc__error" role="alert">
          That bookmark could not be opened.
        </p>
      ) : null}
    </aside>
  );
}
