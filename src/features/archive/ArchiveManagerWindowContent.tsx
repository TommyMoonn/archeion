import { DotsThree, Plus } from "@phosphor-icons/react";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

// Copied from src-tauri/icons/128x128.png so the frontend can load it through Vite.
import archeionIcon from "../../assets/brand/archeion-icon-128.png";
import { Button } from "../../components/Button";
import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
  type ContextMenuController,
} from "../../components/contextMenuController";
import { Input } from "../../components/Input";
import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import type { KnownArchive } from "../../types/archive";
import { ArchiveCreateView } from "./ArchiveCreateView";
import { createArchiveContextActions } from "./archiveContextActions";
import { OpenArchiveButton } from "./OpenArchiveButton";

type ArchiveManagerView = "manager" | "create";
type ArchiveManagerTransitionDirection = "forward" | "back";

type ArchiveManagerWindowContentProps = {
  state: ArchiveState;
  onArchiveChoiceComplete?: () => void | Promise<unknown>;
};

type ArchiveRowProps = {
  activeArchiveId: string | null;
  archive: KnownArchive;
  isMissing: boolean;
  onArchiveChoiceComplete?: () => void | Promise<unknown>;
  setStatus: (status: string | null) => void;
};

type ArchiveRowActionsProps = {
  archive: KnownArchive;
  controller: ContextMenuController;
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

function sortArchives(archives: KnownArchive[]): KnownArchive[] {
  return [...archives].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

function ArchiveRowActions({
  archive,
  controller,
  disabled,
  onForget,
  onReveal,
  onRename,
}: ArchiveRowActionsProps) {
  const actions = createArchiveContextActions({ disabled, onForget, onReveal, onRename });

  return (
    <>
      <span className="archive-row-menu" data-open={controller.isOpen || undefined}>
        <ContextMenuTrigger
          controller={controller}
          disabled={disabled}
          label={`Actions for ${archive.displayName}`}
          title={`Actions for ${archive.displayName}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <DotsThree weight="bold" />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${archive.displayName}`}
        className="archive-row-menu__popover"
        controller={controller}
      />
    </>
  );
}

function ArchiveRow({
  activeArchiveId,
  archive,
  isMissing,
  onArchiveChoiceComplete,
  setStatus,
}: ArchiveRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(archive.displayName);
  const [isBusy, setIsBusy] = useState(false);
  const isActive = archive.id === activeArchiveId;

  async function activateArchive() {
    if (isBusy || isRenaming) {
      return;
    }

    setIsBusy(true);
    setStatus(null);
    try {
      if (isActive) {
        await onArchiveChoiceComplete?.();
        return;
      }

      const changed = await archiveStore.switchArchive(archive.id);
      if (changed) {
        await onArchiveChoiceComplete?.();
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

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (isRenaming) return;
    openContextMenuFromPointer(contextMenu, event, primaryActionRef.current, !isBusy);
  }

  function handlePrimaryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    openContextMenuFromKeyboard(contextMenu, event, !isBusy);
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
      className={`archive-row${isBusy ? " archive-row--busy" : ""}${
        isMissing ? " archive-row--missing" : ""
      }`}
      data-context-menu-open={contextMenu.isOpen || undefined}
      onContextMenu={handleContextMenu}
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
            className="archive-row__activate"
            disabled={isBusy}
            onClick={() => void activateArchive()}
            onKeyDown={handlePrimaryKeyDown}
            ref={primaryActionRef}
            type="button"
          >
            <span className="archive-row__title">{archive.displayName}</span>
            <span className="archive-row__path" title={archive.rootPath}>
              {archive.rootPath}
            </span>
          </button>
        )}
      </div>

      {isMissing ? (
        <div className="archive-row__meta" aria-label="Archive state">
          <span className="archive-row__badge archive-row__badge--missing">
            Archive folder not found
          </span>
        </div>
      ) : null}

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
            controller={contextMenu}
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
  state,
  onArchiveChoiceComplete,
}: ArchiveManagerWindowContentProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<ArchiveManagerView>("manager");
  const [transitionDirection, setTransitionDirection] =
    useState<ArchiveManagerTransitionDirection>("forward");
  const [archiveName, setArchiveName] = useState("");
  const [locationPath, setLocationPath] = useState("");
  const activeArchiveId = activeArchiveIdForState(state);
  const missingArchiveId = state.status === "missing" ? (state.archive?.id ?? null) : null;
  const sortedArchives = useMemo(() => sortArchives(state.archives), [state.archives]);
  const errorText = state.status === "error" ? state.error : null;

  function resetCreateForm() {
    setArchiveName("");
    setLocationPath("");
    setStatus(null);
  }

  return (
    <main className="archive-manager-shell">
      <section
        className="archive-manager-window archive-manager-window--manager"
        aria-labelledby="archive-manager-title"
      >
        <div className="archive-manager-window__body">
          <aside className="archive-manager-window__sidebar" aria-label="Archives">
            {sortedArchives.length > 0 ? (
              <div className="archive-list">
                {sortedArchives.map((archive) => (
                  <ArchiveRow
                    activeArchiveId={activeArchiveId}
                    archive={archive}
                    isMissing={archive.id === missingArchiveId}
                    key={archive.id}
                    onArchiveChoiceComplete={onArchiveChoiceComplete}
                    setStatus={setStatus}
                  />
                ))}
              </div>
            ) : null}
          </aside>

          <section className="archive-manager-window__main">
            <div className="archive-manager-window__identity">
              <div className="archive-manager-window__mark" aria-hidden="true">
                <img className="archive-manager-window__icon" src={archeionIcon} alt="" />
              </div>
              <h1 id="archive-manager-title">Archeion</h1>
              <p>Manage archives</p>
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

            <div
              className="archive-manager-window__content-area"
              data-direction={transitionDirection}
              data-view={view}
            >
              {view === "create" ? (
                <ArchiveCreateView
                  archiveName={archiveName}
                  locationPath={locationPath}
                  onArchiveChoiceComplete={onArchiveChoiceComplete}
                  onArchiveNameChange={setArchiveName}
                  onBack={() => {
                    setStatus(null);
                    setTransitionDirection("back");
                    setView("manager");
                  }}
                  onCreated={() => {
                    resetCreateForm();
                    setTransitionDirection("back");
                    setView("manager");
                  }}
                  onLocationChange={setLocationPath}
                />
              ) : (
                <div className="archive-manager-window__content-panel">
                  <div className="archive-manager-window__actions">
                    <Button
                      className="archive-action-row"
                      icon={<Plus aria-hidden="true" />}
                      onClick={() => {
                        setStatus(null);
                        setTransitionDirection("forward");
                        setView("create");
                      }}
                      variant="secondary"
                    >
                      <span className="archive-action-row__copy">
                        <span className="archive-action-row__title">Create empty archive</span>
                        <span className="archive-action-row__description">
                          Start with a new local folder.
                        </span>
                      </span>
                    </Button>
                    <OpenArchiveButton
                      className="archive-action-row"
                      description="Use an existing folder."
                      onOpened={onArchiveChoiceComplete}
                      variant="secondary"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
