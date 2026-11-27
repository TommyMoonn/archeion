import { Ellipsis, Plus } from "lucide-react";
import {
  useMemo,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { BrandLogo } from "../../components/BrandLogo";
import { Button } from "../../components/Button";
import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
  type ContextMenuController,
} from "../../components/contextMenuController";
import { Input } from "../../components/Input";
import { Badge } from "../../components/ui/badge";
import { Button as UiButton } from "../../components/ui/button";
import { Empty, EmptyDescription } from "../../components/ui/empty";
import { Spinner } from "../../components/ui/spinner";
import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import type { KnownArchive } from "../../types/archive";
import { ArchiveCreateView } from "./ArchiveCreateView";
import { ArchiveManagerLayout } from "./ArchiveManagerLayout";
import { createArchiveContextActions } from "./archiveContextActions";
import { OpenArchiveButton } from "./OpenArchiveButton";

type ArchiveManagerView = "manager" | "create";
type ArchiveManagerTransitionDirection = "forward" | "back";

const archiveStatusClassName =
  "m-0 max-w-archive-message rounded-control border-standard border-solid border-error-border bg-error-soft px-archive-feedback py-field-label text-body leading-field-compact text-error wrap-anywhere";

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
  statusId: string;
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
      <span className="relative">
        <ContextMenuTrigger
          className="hover:bg-surface-shell-hover aria-expanded:bg-surface-shell-hover aria-expanded:text-text-strong hover:control-active:bg-surface-shell-hover aria-expanded:control-active:bg-surface-shell-hover"
          controller={controller}
          disabled={disabled}
          label={`Actions for ${archive.displayName}`}
          tooltip={`Actions for ${archive.displayName}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${archive.displayName}`}
        className="min-w-archive-menu"
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
  statusId,
}: ArchiveRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInvalid, setRenameInvalid] = useState(false);
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(archive.displayName);
  const [isBusy, setIsBusy] = useState(false);
  const isActive = archive.id === activeArchiveId;
  const missingStateId = useId();

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
        setStatus("Archive folder not found. Choose another archive or restore the folder.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function renameArchive() {
    const nextName = name.trim();
    if (!nextName) {
      setRenameInvalid(true);
      setStatus("Archive names cannot be empty.");
      renameInputRef.current?.focus();
      return;
    }

    setIsBusy(true);
    setStatus(null);
    try {
      const renamed = await archiveStore.renameArchive(archive.id, nextName);
      if (renamed) {
        setRenameInvalid(false);
        setIsRenaming(false);
      } else {
        setRenameInvalid(true);
        setStatus("Archive name could not be saved. Try another name.");
        renameInputRef.current?.focus();
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
        setStatus("Archive folder could not be opened. Check that the folder still exists.");
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
        setStatus("Archive could not be forgotten. Try again.");
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      aria-busy={isBusy || undefined}
      className={`group/archive relative grid min-h-archive-row grid-cols-archive-row grid-rows-archive-row items-center gap-x-field-label gap-y-control-inset rounded-control border-standard border-solid border-transparent py-field-label pr-archive-row-end pl-sidebar-inset hover:bg-surface-shell-hover data-active:bg-surface-shell-active ${
        isMissing
          ? "bg-error-soft inset-shadow-archive-missing"
          : isBusy
            ? "bg-archive-busy"
            : "bg-transparent"
      }`}
      data-archive-row=""
      data-active={isActive || undefined}
      data-missing={isMissing || undefined}
      onContextMenu={handleContextMenu}
    >
      <div className="col-start-1 row-start-1 min-w-0">
        {isRenaming ? (
          <div className="relative min-w-0">
            <Input
              aria-describedby={renameInvalid ? statusId : undefined}
              aria-invalid={renameInvalid || undefined}
              autoFocus
              className="w-full min-h-field-standard [&>input]:pe-archive-rename-end"
              label="Archive display name"
              onChange={(event) => {
                setName(event.currentTarget.value);
                setRenameInvalid(false);
                setStatus(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void renameArchive();
                }
                if (event.key === "Escape") {
                  setName(archive.displayName);
                  setRenameInvalid(false);
                  setIsRenaming(false);
                }
              }}
              ref={renameInputRef}
              required
              value={name}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 end-archive-feedback -translate-y-1/2 text-caption font-medium leading-none text-muted"
            >
              Required
            </span>
          </div>
        ) : (
          <UiButton
            aria-current={isActive ? "true" : undefined}
            aria-describedby={isMissing ? missingStateId : undefined}
            className="grid w-full min-w-0 cursor-pointer gap-control-inset rounded-none border-0 bg-transparent p-0 text-start text-inherit disabled:cursor-not-allowed disabled:opacity-100"
            disabled={isBusy}
            onClick={() => void activateArchive()}
            onKeyDown={handlePrimaryKeyDown}
            ref={primaryActionRef}
            size={null}
            type="button"
            variant={null}
          >
            <span className="min-w-0 text-body font-regular leading-archive-row-title text-text-strong wrap-anywhere whitespace-normal">
              {archive.displayName}
            </span>
            <span
              className="min-w-0 text-caption leading-archive-row-path text-muted opacity-78 wrap-anywhere whitespace-normal"
              title={archive.rootPath}
            >
              {archive.rootPath}
            </span>
          </UiButton>
        )}
      </div>

      {isMissing ? (
        <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap" aria-label="Archive state">
          <Badge
            className="min-h-archive-badge border-archive-missing-border bg-archive-missing px-control-gap-compact py-0 font-medium leading-inherit tracking-archive-badge text-error whitespace-normal"
            id={missingStateId}
          >
            Archive folder not found
          </Badge>
        </div>
      ) : null}

      <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end opacity-72 group-hover/archive:opacity-100 group-focus-within/archive:opacity-100">
        {isRenaming ? (
          <Button
            className="min-h-archive-save cursor-pointer rounded-small px-archive-feedback text-caption disabled:cursor-not-allowed"
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
              setRenameInvalid(false);
              setStatus(null);
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
  const statusId = "archive-manager-operation-status";
  const activeArchiveId = activeArchiveIdForState(state);
  const missingArchiveId = state.status === "missing" ? (state.archive?.id ?? null) : null;
  const sortedArchives = useMemo(() => sortArchives(state.archives), [state.archives]);
  const errorText =
    state.status === "error"
      ? "Archives could not be loaded. Close and reopen Archive Manager to try again."
      : null;
  const isLoading = state.status === "loading";

  function resetCreateForm() {
    setArchiveName("");
    setLocationPath("");
    setStatus(null);
  }

  return (
    <ArchiveManagerLayout
      titleId="archive-manager-title"
      busy={isLoading}
      ready={!isLoading}
      sidebar={
        sortedArchives.length > 0 ? (
          <div className="grid w-full min-h-0 flex-1 content-start gap-archive-row-end overflow-y-auto py-control-inset">
            {sortedArchives.map((archive) => (
              <ArchiveRow
                activeArchiveId={activeArchiveId}
                archive={archive}
                isMissing={archive.id === missingArchiveId}
                key={archive.id}
                onArchiveChoiceComplete={onArchiveChoiceComplete}
                setStatus={setStatus}
                statusId={statusId}
              />
            ))}
          </div>
        ) : isLoading ? (
          <div className="grid flex-1 place-items-center text-muted">
            <Spinner aria-label="Loading archives" className="size-6 stroke-2" data-visible />
          </div>
        ) : (
          <Empty className="m-auto max-w-archive-empty self-center px-button-standard py-dialog-panel text-center">
            <EmptyDescription className="leading-field-compact">No saved archives</EmptyDescription>
          </Empty>
        )
      }
    >
      <div className="grid justify-items-center gap-button-standard text-center">
        <div className="grid size-archive-mark place-items-center" aria-hidden="true">
          <BrandLogo className="size-archive-logo drop-shadow-archive-logo" />
        </div>
        <div className="grid justify-items-center gap-field-label">
          <h1
            className="m-0 font-app-display text-display-compact font-semibold leading-none tracking-archive-wordmark text-text-strong"
            id="archive-manager-title"
          >
            Archeion
          </h1>
          <p className="m-0 text-body leading-field-compact text-muted">Manage archives</p>
          {errorText ? (
            <p className={archiveStatusClassName} data-tone="error" role="alert">
              {errorText}
            </p>
          ) : null}
          {status ? (
            <p className={archiveStatusClassName} data-tone="error" id={statusId} role="status">
              {status}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="archive-manager-window__content-area grid w-full max-w-archive-content min-w-0 justify-self-center"
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
    </ArchiveManagerLayout>
  );
}
