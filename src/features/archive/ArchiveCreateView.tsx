import { ArrowLeft, FolderOpen } from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";

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
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const browseButtonRef = useRef<HTMLButtonElement | null>(null);
  const generatedId = useId();
  const nameLabelId = `archive-create-name-label-${generatedId}`;
  const nameDescriptionId = `archive-create-name-description-${generatedId}`;
  const nameErrorId = `archive-create-name-error-${generatedId}`;
  const locationLabelId = `archive-create-location-label-${generatedId}`;
  const locationDescriptionId = `archive-create-location-description-${generatedId}`;
  const locationErrorId = `archive-create-location-error-${generatedId}`;
  const normalizedName = normalizeArchiveName(archiveName);
  const nameError = validateArchiveName(archiveName);
  const visibleNameError = validationAttempted || archiveName ? nameError : null;
  const locationError =
    validationAttempted && !locationPath ? "Choose a location for the archive." : null;
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
    setValidationAttempted(true);
    if (nameError) {
      nameInputRef.current?.focus();
      return;
    }
    if (!locationPath) {
      browseButtonRef.current?.focus();
      return;
    }
    if (!canCreate) {
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

      <form className="archive-create-form" noValidate onSubmit={submitForm}>
        <div className="archive-create-form__card">
          <div className="archive-create-form__row archive-create-form__row--input">
            <div className="archive-create-form__label-block">
              <label htmlFor="archive-create-name" id={nameLabelId}>
                Archive name <span className="form-required">Required</span>
              </label>
              <span id={nameDescriptionId}>Creates a folder with this name.</span>
            </div>
            <Input
              aria-describedby={
                [nameDescriptionId, visibleNameError ? nameErrorId : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              aria-invalid={visibleNameError ? true : undefined}
              aria-labelledby={nameLabelId}
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
              required
              spellCheck={false}
              value={archiveName}
            />
          </div>

          <div
            aria-describedby={
              [locationDescriptionId, locationError ? locationErrorId : undefined]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={locationError ? true : undefined}
            aria-labelledby={locationLabelId}
            className="archive-create-form__row"
            role="group"
          >
            <div className="archive-create-form__row-copy">
              <span className="archive-create-form__row-label" id={locationLabelId}>
                Location <span className="form-required">Required</span>
              </span>
              <span
                className="archive-create-form__row-description"
                id={locationDescriptionId}
                title={locationPath || undefined}
              >
                {locationPath || "Choose a parent folder"}
              </span>
            </div>
            <Button
              className="archive-create-form__browse"
              disabled={isBrowsing || isCreating}
              icon={<FolderOpen aria-hidden="true" />}
              onClick={() => void browseLocation()}
              ref={browseButtonRef}
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

        {visibleNameError ? (
          <p
            className="archive-create-form__status"
            data-tone="error"
            id={nameErrorId}
            role="alert"
          >
            {visibleNameError}
          </p>
        ) : null}

        {locationError ? (
          <p
            className="archive-create-form__status"
            data-tone="error"
            id={locationErrorId}
            role="alert"
          >
            {locationError}
          </p>
        ) : null}

        {status ? (
          <p className="archive-create-form__status" data-tone="error" role="alert">
            {status}
          </p>
        ) : null}

        <div className="archive-create-form__footer">
          <Button disabled={isCreating} type="submit" variant="primary">
            {isCreating ? "Creating" : "Create"}
          </Button>
        </div>
      </form>
    </section>
  );
}
