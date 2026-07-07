import {
  Check,
  FolderOpen,
  PencilSimple,
  SignIn,
  Trash,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Input } from "../../components/Input";
import { vaultStore } from "../../stores/vaultStore";
import type { KnownArchive } from "../../types/archive";
import { useVault } from "../vault/useVault";

type ArchiveManagerDialogProps = {
  onClose: () => void;
};

function archivePathLabel(archive: KnownArchive) {
  return archive.rootPath;
}

export function ArchiveManagerDialog({ onClose }: ArchiveManagerDialogProps) {
  const state = useVault();
  const activeArchiveId = state.status === "ready" ? state.archive.id : null;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const archives = state.archives;

  async function openAnotherArchive() {
    setStatus(null);
    const changed = await vaultStore.chooseVault();
    if (changed) {
      onClose();
    }
  }

  async function switchArchive(archive: KnownArchive) {
    if (archive.id === activeArchiveId) {
      return;
    }

    setBusyId(archive.id);
    setStatus(null);
    try {
      const changed = await vaultStore.switchArchive(archive.id);
      if (changed) {
        onClose();
      } else {
        setStatus("Archive folder not found.");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function revealArchive(archive: KnownArchive) {
    setBusyId(archive.id);
    setStatus(null);
    try {
      const revealed = await vaultStore.revealArchive(archive.id);
      if (!revealed) {
        setStatus("Archive folder could not be revealed.");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function renameArchive(archive: KnownArchive) {
    const name = renameValue.trim();
    if (!name) {
      setStatus("Archive names cannot be empty.");
      return;
    }

    setBusyId(archive.id);
    setStatus(null);
    try {
      const renamed = await vaultStore.renameArchive(archive.id, name);
      if (renamed) {
        setRenamingId(null);
        setRenameValue("");
      } else {
        setStatus("Archive name could not be saved.");
      }
    } finally {
      setBusyId(null);
    }
  }

  async function forgetArchive(archive: KnownArchive) {
    setBusyId(archive.id);
    setStatus(null);
    try {
      const forgotten = await vaultStore.forgetArchive(archive.id);
      if (!forgotten) {
        setStatus("Archive could not be forgotten.");
      }
      if (archive.id === activeArchiveId) {
        onClose();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog
      title="Archives"
      description="Switch archives or manage saved folders. Local files are not deleted."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            icon={<FolderOpen aria-hidden="true" size={18} />}
            onClick={() => void openAnotherArchive()}
          >
            Open another archive
          </Button>
        </>
      }
    >
      <div className="archive-manager">
        {status ? (
          <p className="archive-manager__status" role="status">
            {status}
          </p>
        ) : null}
        {archives.length === 0 ? (
          <p className="archive-manager__empty">No saved archives.</p>
        ) : (
          <div className="archive-manager__list">
            {archives.map((archive) => {
              const isActive = archive.id === activeArchiveId;
              const isRenaming = archive.id === renamingId;
              const isBusy = archive.id === busyId;

              return (
                <div className="archive-manager__item" key={archive.id}>
                  <div className="archive-manager__meta">
                    {isRenaming ? (
                      <Input
                        autoFocus
                        label="Archive display name"
                        onChange={(event) => setRenameValue(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void renameArchive(archive);
                          }
                          if (event.key === "Escape") {
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                        value={renameValue}
                      />
                    ) : (
                      <strong>{archive.displayName}</strong>
                    )}
                    <span title={archivePathLabel(archive)}>{archivePathLabel(archive)}</span>
                  </div>
                  <div className="archive-manager__actions">
                    {isRenaming ? (
                      <Button
                        disabled={isBusy}
                        onClick={() => void renameArchive(archive)}
                        variant="secondary"
                      >
                        Save
                      </Button>
                    ) : (
                      <>
                        <Button
                          disabled={isActive || isBusy}
                          icon={
                            isActive ? (
                              <Check aria-hidden="true" size={16} />
                            ) : (
                              <SignIn aria-hidden="true" size={16} />
                            )
                          }
                          onClick={() => void switchArchive(archive)}
                          variant="secondary"
                        >
                          {isActive ? "Active" : "Open"}
                        </Button>
                        <Button
                          disabled={isBusy}
                          onClick={() => void revealArchive(archive)}
                          variant="ghost"
                        >
                          Reveal
                        </Button>
                        <Button
                          disabled={isBusy}
                          icon={<PencilSimple aria-hidden="true" size={16} />}
                          onClick={() => {
                            setRenamingId(archive.id);
                            setRenameValue(archive.displayName);
                          }}
                          variant="ghost"
                        >
                          Rename
                        </Button>
                        <Button
                          disabled={isBusy}
                          icon={<Trash aria-hidden="true" size={16} />}
                          onClick={() => void forgetArchive(archive)}
                          variant="ghost"
                        >
                          Forget
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
