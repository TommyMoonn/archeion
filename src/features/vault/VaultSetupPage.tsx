import { FolderDashed } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { VaultState } from "../../stores/vaultStore";
import { vaultStore } from "../../stores/vaultStore";
import type { KnownArchive } from "../../types/archive";
import { OpenVaultButton } from "./OpenVaultButton";

type VaultSetupPageProps = {
  state: Exclude<VaultState, { status: "ready" }>;
};

function SavedArchiveRow({ archive }: { archive: KnownArchive }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(archive.displayName);
  const [isBusy, setIsBusy] = useState(false);

  async function rename() {
    const nextName = name.trim();
    if (!nextName) {
      return;
    }

    setIsBusy(true);
    try {
      const renamed = await vaultStore.renameArchive(archive.id, nextName);
      if (renamed) {
        setIsRenaming(false);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function openArchive() {
    setIsBusy(true);
    try {
      await vaultStore.switchArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function revealArchive() {
    setIsBusy(true);
    try {
      await vaultStore.revealArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function forgetArchive() {
    setIsBusy(true);
    try {
      await vaultStore.forgetArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="vault-archive-row">
      <div className="vault-archive-row__copy">
        {isRenaming ? (
          <Input
            autoFocus
            label="Archive display name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void rename();
              }
              if (event.key === "Escape") {
                setName(archive.displayName);
                setIsRenaming(false);
              }
            }}
            value={name}
          />
        ) : (
          <strong>{archive.displayName}</strong>
        )}
        <span title={archive.rootPath}>{archive.rootPath}</span>
      </div>
      <div className="vault-archive-row__actions">
        {isRenaming ? (
          <Button disabled={isBusy} onClick={() => void rename()} variant="secondary">
            Save
          </Button>
        ) : (
          <>
            <Button disabled={isBusy} onClick={() => void openArchive()} variant="secondary">
              Open
            </Button>
            <Button disabled={isBusy} onClick={() => void revealArchive()} variant="ghost">
              Reveal
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => {
                setName(archive.displayName);
                setIsRenaming(true);
              }}
              variant="ghost"
            >
              Rename
            </Button>
            <Button disabled={isBusy} onClick={() => void forgetArchive()} variant="ghost">
              Forget
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function launcherCopy(state: VaultSetupPageProps["state"]) {
  if (state.status === "missing") {
    return {
      title: "Archive folder not found",
      description: "The saved folder may have been moved, renamed, or disconnected.",
    };
  }

  if (state.status === "error") {
    return {
      title: "Archive could not open",
      description: state.error,
    };
  }

  return {
    title: "No archive open",
    description: "Choose a folder that contains your EPUBs.",
  };
}

export function VaultSetupPage({ state }: VaultSetupPageProps) {
  const isMissing = state.status === "missing";
  const { title, description } = launcherCopy(state);

  return (
    <main className="vault-launcher">
      <aside className="vault-launcher__sidebar" aria-label="Saved archives">
        <div className="vault-launcher__sidebar-header">
          <span className="section-label">Archives</span>
          <span>{state.archives.length}</span>
        </div>
        {state.archives.length > 0 ? (
          <div className="vault-archive-list">
            {state.archives.map((archive) => (
              <SavedArchiveRow archive={archive} key={archive.id} />
            ))}
          </div>
        ) : (
          <p className="vault-launcher__empty">No saved archives.</p>
        )}
      </aside>

      <section className="vault-launcher__main" aria-labelledby="archive-launcher-title">
        <div className="vault-launcher__identity">
          <div className="vault-launcher__icon" aria-hidden="true">
            <FolderDashed size={34} weight="thin" />
          </div>
          <p className="eyebrow">Archeion</p>
          <h1 id="archive-launcher-title">{title}</h1>
          <p>{description}</p>
        </div>

        <div className="vault-launcher__actions">
          <OpenVaultButton action="create" variant="secondary" />
          <OpenVaultButton action="open" />
        </div>

        {isMissing ? (
          <div className="vault-launcher__recovery">
            <Button variant="secondary" onClick={() => void vaultStore.retry()}>
              Try again
            </Button>
            {state.archive ? (
              <Button
                variant="ghost"
                onClick={() => void vaultStore.forgetArchive(state.archive!.id)}
              >
                Forget missing archive
              </Button>
            ) : null}
          </div>
        ) : null}

        <p className="vault-launcher__note">EPUB files stay in their existing folders.</p>
      </section>
    </main>
  );
}
