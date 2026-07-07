import {
  ArrowLeft,
  Check,
  DotsThree,
  FolderDashed,
  FolderOpen,
  PencilSimple,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import type { KnownArchive } from "../../types/archive";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { OpenArchiveButton } from "./OpenArchiveButton";

type ArchiveManagerMode = "launcher" | "manager";

type ArchiveManagerWindowContentProps = {
  mode: ArchiveManagerMode;
  state: ArchiveState;
  onArchiveActivated?: () => void;
  onBack?: () => void;
};

type ArchiveRowProps = {
  activeArchiveId: string | null;
  archive: KnownArchive;
  isMissing: boolean;
  onArchiveActivated?: () => void;
  setStatus: (status: string | null) => void;
};

type ArchiveRowActionsProps = {
  archive: KnownArchive;
  disabled: boolean;
  onForget: () => void;
  onReveal: () => void;
  onRename: () => void;
};

function activeArchiveIdForState(state: ArchiveState): string | null {
  if (state.status === "ready") {
    return state.archive.id;
  }

  if (state.status === "missing") {
    return state.archive?.id ?? null;
  }

  return null;
}

function surfaceTitle(mode: ArchiveManagerMode, state: ArchiveState): string {
  if (mode === "manager") {
    return "Manage archives";
  }

  if (state.status === "missing") {
    return "Archive folder not found";
  }

  if (state.status === "error") {
    return "Archive could not open";
  }

  if (state.status === "loading") {
    return "Opening archive";
  }

  return "No archive open";
}

function sortArchives(
  archives: KnownArchive[],
  activeArchiveId: string | null,
): KnownArchive[] {
  return [...archives].sort((left, right) => {
    if (left.id === activeArchiveId) {
      return -1;
    }
    if (right.id === activeArchiveId) {
      return 1;
    }
    return right.lastOpenedAt.localeCompare(left.lastOpenedAt);
  });
}

function ArchiveRowActions({
  archive,
  disabled,
  onForget,
  onReveal,
  onRename,
}: ArchiveRowActionsProps) {
  const { closeDetails, detailsRef } = useDismissibleDetails();

  function runAction(action: () => void) {
    closeDetails();
    action();
  }

  return (
    <details
      className="archive-row-menu"
      ref={detailsRef}
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        aria-label={`Actions for ${archive.displayName}`}
        title={`Actions for ${archive.displayName}`}
      >
        <DotsThree aria-hidden="true" size={18} weight="bold" />
      </summary>
      <div className="archive-row-menu__popover" role="menu">
        <button
          disabled={disabled}
          onClick={() => runAction(onRename)}
          role="menuitem"
          type="button"
        >
          <PencilSimple aria-hidden="true" size={16} weight="regular" />
          <span>Rename</span>
        </button>
        <button
          disabled={disabled}
          onClick={() => runAction(onReveal)}
          role="menuitem"
          type="button"
        >
          <FolderOpen aria-hidden="true" size={16} weight="regular" />
          <span>Reveal folder</span>
        </button>
        <button
          className="archive-row-menu__danger"
          disabled={disabled}
          onClick={() => runAction(onForget)}
          role="menuitem"
          type="button"
        >
          <Trash aria-hidden="true" size={16} weight="regular" />
          <span>Forget archive</span>
        </button>
      </div>
    </details>
  );
}

function ArchiveRow({
  activeArchiveId,
  archive,
  isMissing,
  onArchiveActivated,
  setStatus,
}: ArchiveRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(archive.displayName);
  const [isBusy, setIsBusy] = useState(false);
  const isActive = archive.id === activeArchiveId;

  async function activateArchive() {
    if (isActive || isBusy || isRenaming) {
      return;
    }

    setIsBusy(true);
    setStatus(null);
    try {
      const changed = await archiveStore.switchArchive(archive.id);
      if (changed) {
        onArchiveActivated?.();
      } else {
        setStatus("Archive folder not found.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function renameArchive() {
    const nextName = name.trim();
    if (!nextName) {
      setStatus("Archive names cannot be empty.");
      return;
    }

    setIsBusy(true);
    setStatus(null);
    try {
      const renamed = await archiveStore.renameArchive(archive.id, nextName);
      if (renamed) {
        setIsRenaming(false);
      } else {
        setStatus("Archive name could not be saved.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function revealArchive() {
    setIsBusy(true);
    setStatus(null);
    try {
      const revealed = await archiveStore.revealArchive(archive.id);
      if (!revealed) {
        setStatus("Archive folder could not be revealed.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function forgetArchive() {
    setIsBusy(true);
    setStatus(null);
    try {
      const forgotten = await archiveStore.forgetArchive(archive.id);
      if (!forgotten) {
        setStatus("Archive could not be forgotten.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className={`archive-row${isActive ? " archive-row--active" : ""}${
        isMissing ? " archive-row--missing" : ""
      }`}
    >
      <div className="archive-row__main">
        {isRenaming ? (
          <Input
            autoFocus
            className="archive-row__input"
            label="Archive display name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void renameArchive();
              }
              if (event.key === "Escape") {
                setName(archive.displayName);
                setIsRenaming(false);
              }
            }}
            value={name}
          />
        ) : (
          <button
            aria-current={isActive ? "page" : undefined}
            className="archive-row__activate"
            disabled={isActive || isBusy}
            onClick={() => void activateArchive()}
            type="button"
          >
            <span className="archive-row__title">{archive.displayName}</span>
            <span className="archive-row__path" title={archive.rootPath}>
              {archive.rootPath}
            </span>
          </button>
        )}
      </div>

      <div className="archive-row__meta" aria-label="Archive state">
        {isActive ? (
          <span className="archive-row__badge">
            <Check aria-hidden="true" size={13} weight="bold" />
            Active
          </span>
        ) : null}
        {isMissing ? (
          <span className="archive-row__badge archive-row__badge--missing">
            Archive folder not found
          </span>
        ) : null}
      </div>

      <div className="archive-row__actions">
        {isRenaming ? (
          <Button
            className="archive-row__save"
            disabled={isBusy}
            onClick={() => void renameArchive()}
            variant="secondary"
          >
            Save
          </Button>
        ) : (
          <ArchiveRowActions
            archive={archive}
            disabled={isBusy}
            onForget={() => void forgetArchive()}
            onReveal={() => void revealArchive()}
            onRename={() => {
              setName(archive.displayName);
              setIsRenaming(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function ArchiveManagerWindowContent({
  mode,
  state,
  onArchiveActivated,
  onBack,
}: ArchiveManagerWindowContentProps) {
  const [status, setStatus] = useState<string | null>(null);
  const activeArchiveId = activeArchiveIdForState(state);
  const missingArchiveId =
    state.status === "missing" ? state.archive?.id ?? null : null;
  const sortedArchives = useMemo(
    () => sortArchives(state.archives, activeArchiveId),
    [activeArchiveId, state.archives],
  );
  const title = surfaceTitle(mode, state);
  const errorText = state.status === "error" ? state.error : null;

  return (
    <main className="archive-manager-shell">
      <section
        className={`archive-manager-window archive-manager-window--${mode}`}
        aria-labelledby="archive-manager-title"
      >
        <div className="archive-manager-window__chrome">
          <span>{mode === "manager" ? "Archive Manager" : "Archive Launcher"}</span>
          {onBack ? (
            <button
              className="archive-manager-window__back"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={15} weight="bold" />
              Back to Library
            </button>
          ) : null}
        </div>

        <div className="archive-manager-window__body">
          <aside
            className="archive-manager-window__sidebar"
            aria-label="Known archives"
          >
            <div className="archive-manager-window__sidebar-header">
              <span className="section-label">Known archives</span>
              <span>{state.archives.length}</span>
            </div>

            {sortedArchives.length > 0 ? (
              <div className="archive-list">
                {sortedArchives.map((archive) => (
                  <ArchiveRow
                    activeArchiveId={activeArchiveId}
                    archive={archive}
                    isMissing={archive.id === missingArchiveId}
                    key={archive.id}
                    onArchiveActivated={onArchiveActivated}
                    setStatus={setStatus}
                  />
                ))}
              </div>
            ) : (
              <p className="archive-manager-window__empty">No saved archives.</p>
            )}
          </aside>

          <section className="archive-manager-window__main">
            <div className="archive-manager-window__identity">
              <div className="archive-manager-window__mark" aria-hidden="true">
                {state.status === "missing" || state.status === "error" ? (
                  <WarningCircle size={38} weight="thin" />
                ) : (
                  <FolderDashed size={38} weight="thin" />
                )}
              </div>
              <h1 id="archive-manager-title">Archeion</h1>
              <p>{title}</p>
              {errorText ? (
                <p className="archive-manager-window__status" role="alert">
                  {errorText}
                </p>
              ) : null}
              {status ? (
                <p className="archive-manager-window__status" role="status">
                  {status}
                </p>
              ) : null}
            </div>

            <div className="archive-manager-window__actions">
              <OpenArchiveButton
                action="create"
                className="archive-action-row"
                onOpened={onArchiveActivated}
                variant="secondary"
              />
              <OpenArchiveButton
                action="open"
                className="archive-action-row"
                onOpened={onArchiveActivated}
                variant="secondary"
              />
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
