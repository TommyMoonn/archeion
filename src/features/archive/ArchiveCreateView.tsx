import { ArrowLeft, FolderOpen } from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { archiveStore } from "../../stores/archiveStore";
import {
  deriveArchivePath,
  normalizeArchiveName,
  validateArchiveName,
} from "./archiveNameValidation";

type ArchiveCreateViewProps = {
  archiveName: string;
  locationPath: string;
  onArchiveChoiceComplete?: () => void | Promise<unknown>;
  onArchiveNameChange: (value: string) => void;
  onBack: () => void;
  onCreated: () => void;
  onLocationChange: (value: string) => void;
};

export function ArchiveCreateView({
  archiveName,
  locationPath,
  onArchiveChoiceComplete,
  onArchiveNameChange,
  onBack,
  onCreated,
  onLocationChange,
}: ArchiveCreateViewProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedName = normalizeArchiveName(archiveName);
  const nameError = validateArchiveName(archiveName);
  const finalPath = useMemo(
    () => deriveArchivePath(locationPath, archiveName),
    [archiveName, locationPath],
  );
  const canCreate = Boolean(!nameError && normalizedName && locationPath && !isCreating);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  async function browseLocation() {
    if (isBrowsing || isCreating) {
      return;
    }

    setIsBrowsing(true);
    setStatus(null);
    try {
      const selected = await archiveStore.chooseArchiveParentLocation();
      if (selected) {
        onLocationChange(selected);
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  async function createArchive() {
    if (!canCreate) {
      setStatus(nameError ?? "Choose a location for the archive.");
      return;
    }

    setIsCreating(true);
    setStatus(null);
    try {
      const created = await archiveStore.createEmptyArchive({
        archiveName: normalizedName,
        parentPath: locationPath,
      });

      if (!created) {
        setStatus(archiveStore.getLastOperationError() ?? "Archive could not be created.");
        return;
      }

      onCreated();
      await onArchiveChoiceComplete?.();
    } finally {
      setIsCreating(false);
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createArchive();
  }

  return (
    <section
      aria-labelledby="archive-create-title"
      className="archive-create-view archive-manager-window__content-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <button className="archive-create-view__back" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={16} />
        <span>Back</span>
      </button>

      <div className="archive-create-view__heading">
        <h2 id="archive-create-title">Create archive</h2>
      </div>

      <form className="archive-create-form" onSubmit={submitForm}>
        <div className="archive-create-form__card">
          <div className="archive-create-form__row archive-create-form__row--input">
            <div className="archive-create-form__label-block">
              <label htmlFor="archive-create-name">Archive name</label>
              <span>Creates a folder with this name.</span>
            </div>
            <Input
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              id="archive-create-name"
              label="Archive name"
              name="archeion-create-archive-name"
              onChange={(event) => {
                onArchiveNameChange(event.currentTarget.value);
                setStatus(null);
              }}
              placeholder="Light novels"
              ref={nameInputRef}
              spellCheck={false}
              value={archiveName}
            />
          </div>

          <div className="archive-create-form__row">
            <div className="archive-create-form__row-copy">
              <span className="archive-create-form__row-label">Location</span>
              <span
                className="archive-create-form__row-description"
                title={locationPath || undefined}
              >
                {locationPath || "Choose a parent folder"}
              </span>
            </div>
            <Button
              className="archive-create-form__browse"
              disabled={isBrowsing || isCreating}
              icon={<FolderOpen aria-hidden="true" size={16} />}
              onClick={() => void browseLocation()}
              variant="secondary"
            >
              {isBrowsing ? "Browsing" : "Browse"}
            </Button>
          </div>
        </div>

        {finalPath ? (
          <p className="archive-create-form__path" title={finalPath}>
            {finalPath}
          </p>
        ) : null}

        {nameError && archiveName ? (
          <p className="archive-create-form__status" role="alert">
            {nameError}
          </p>
        ) : null}

        {status ? (
          <p className="archive-create-form__status" role="alert">
            {status}
          </p>
        ) : null}

        <div className="archive-create-form__footer">
          <Button disabled={!canCreate} type="submit" variant="primary">
            {isCreating ? "Creating" : "Create"}
          </Button>
        </div>
      </form>
    </section>
  );
}
