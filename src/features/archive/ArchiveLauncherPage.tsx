import { FolderDashed } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { ArchiveState } from "../../stores/archiveStore";
import { archiveStore } from "../../stores/archiveStore";
import type { KnownArchive } from "../../types/archive";
import { OpenArchiveButton } from "./OpenArchiveButton";

type ArchiveLauncherPageProps = {
  state: Exclude<ArchiveState, { status: "ready" }>;
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
      const renamed = await archiveStore.renameArchive(archive.id, nextName);
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
      await archiveStore.switchArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function revealArchive() {
    setIsBusy(true);
    try {
      await archiveStore.revealArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  async function forgetArchive() {
    setIsBusy(true);
    try {
      await archiveStore.forgetArchive(archive.id);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="archive-row">
      <div className="archive-row__copy">
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
      <div className="archive-row__actions">
        {isRenaming ? (
          <Button
            disabled={isBusy}
            onClick={() => void rename()}
            variant="secondary"
          >
            Save
          </Button>
        ) : (
          <>
            <Button
              disabled={isBusy}
              onClick={() => void openArchive()}
              variant="secondary"
            >
              Open
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => void revealArchive()}
              variant="ghost"
            >
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
            <Button
              disabled={isBusy}
              onClick={() => void forgetArchive()}
              variant="ghost"
            >
              Forget
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function launcherCopy(state: ArchiveLauncherPageProps["state"]) {
  if (state.status === "missing") {
    return {
      title: "Archive folder not found",
      description:
        "The saved folder may have been moved, renamed, or disconnected.",
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

export function ArchiveLauncherPage({ state }: ArchiveLauncherPageProps) {
  const isMissing = state.status === "missing";
  const { title, description } = launcherCopy(state);

  return (
    <main className="archive-launcher">
      <aside className="archive-launcher__sidebar" aria-label="Saved archives">
        <div className="archive-launcher__sidebar-header">
          <span className="section-label">Archives</span>
          <span>{state.archives.length}</span>
        </div>
        {state.archives.length > 0 ? (
          <div className="archive-list">
            {state.archives.map((archive) => (
              <SavedArchiveRow archive={archive} key={archive.id} />
            ))}
          </div>
        ) : (
          <p className="archive-launcher__empty">No saved archives.</p>
        )}
      </aside>

      <section
        className="archive-launcher__main"
        aria-labelledby="archive-launcher-title"
      >
        <div className="archive-launcher__identity">
          <div className="archive-launcher__icon" aria-hidden="true">
            <FolderDashed size={34} weight="thin" />
          </div>
          <p className="eyebrow">Archeion</p>
          <h1 id="archive-launcher-title">{title}</h1>
          <p>{description}</p>
        </div>

        <div className="archive-launcher__actions">
          <OpenArchiveButton action="create" variant="secondary" />
          <OpenArchiveButton action="open" />
        </div>

        {isMissing ? (
          <div className="archive-launcher__recovery">
            <Button
              variant="secondary"
              onClick={() => void archiveStore.retry()}
            >
              Try again
            </Button>
            {state.archive ? (
              <Button
                variant="ghost"
                onClick={() =>
                  void archiveStore.forgetArchive(state.archive!.id)
                }
              >
                Forget missing archive
              </Button>
            ) : null}
          </div>
        ) : null}

        <p className="archive-launcher__note">
          EPUB files stay in their existing folders.
        </p>
      </section>
    </main>
  );
}
