import { ArrowLeft, FolderOpen } from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Alert } from "../../components/ui/alert";
import { Button as UiButton } from "../../components/ui/button";
import { Field, FieldLabel, FieldRequired } from "../../components/ui/field";
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

const formRow =
  "grid min-h-archive-form-row items-center gap-select-trigger-gap px-field-inline py-field-standard-block archive-form-narrow:grid-cols-1 archive-form-narrow:items-stretch";
const fieldLabel = "text-meta-only leading-inherit tracking-normal text-text-strong";
const fieldDescription =
  "min-w-0 text-caption leading-archive-form-description text-muted wrap-anywhere whitespace-normal";
const formError = "static text-meta-only leading-field-compact text-error text-start";

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
      className="grid w-full min-w-0 content-start gap-button-standard app-motion:motion-safe:animate-archive-slide archive-slide-forward"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <UiButton
        className="inline-grid auto-cols-max grid-flow-col min-h-control-compact items-center justify-self-start gap-field-label rounded-control border-transparent bg-transparent px-field-compact-inline py-0 text-meta-only leading-inherit text-muted cursor-pointer control-hover:border-line control-hover:bg-surface-shell-hover control-hover:text-text-strong"
        onClick={onBack}
        size={null}
        type="button"
        variant={null}
      >
        <ArrowLeft className="block size-icon-glyph-standard" aria-hidden="true" />
        <span>Back</span>
      </UiButton>

      <h2
        className="m-0 min-w-0 px-control-inset font-app-display text-heading leading-inherit tracking-archive-fallback text-text-strong"
        id="archive-create-title"
      >
        Create archive
      </h2>

      <form
        aria-labelledby="archive-create-title"
        className="grid gap-archive-form-gap"
        noValidate
        onSubmit={submitForm}
      >
        <div className="grid overflow-hidden rounded-menu border-standard border-solid border-line-subtle bg-surface-main-raised">
          <div className={`${formRow} grid-cols-archive-form-name`}>
            <Field className="gap-archive-action-gap" htmlFor="archive-create-name">
              <FieldLabel className={fieldLabel} id={nameLabelId}>
                Archive name{" "}
                <FieldRequired className="leading-archive-form-description text-muted">
                  Required
                </FieldRequired>
              </FieldLabel>
              <span className={fieldDescription} id={nameDescriptionId}>
                Creates a folder with this name.
              </span>
            </Field>
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
              className="w-full max-w-archive-form-input min-w-0 justify-self-end border-transparent bg-surface-main focus-within:border-transparent focus-within:bg-surface-main has-[input[aria-invalid=true]]:border-transparent archive-form-narrow:max-w-none"
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
              size="standard"
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
            className={`${formRow} grid-cols-archive-form-location border-0 border-t border-solid border-line`}
            role="group"
          >
            <div className="grid min-w-0 gap-archive-action-gap">
              <FieldLabel className={fieldLabel} id={locationLabelId}>
                Location <FieldRequired>Required</FieldRequired>
              </FieldLabel>
              <span
                className={fieldDescription}
                id={locationDescriptionId}
                title={locationPath || undefined}
              >
                {locationPath || "Choose a parent folder"}
              </span>
            </div>
            <Button
              className="min-h-field-standard cursor-pointer px-sidebar-inset disabled:cursor-not-allowed aria-busy:disabled:cursor-not-allowed archive-form-narrow:w-full archive-form-narrow:min-w-0 archive-form-narrow:whitespace-normal"
              busy={isBrowsing}
              busyStatus="Choosing archive location…"
              disabled={isBrowsing || isCreating}
              icon={<FolderOpen aria-hidden="true" />}
              onClick={() => void browseLocation()}
              ref={browseButtonRef}
              variant="secondary"
            >
              Browse
            </Button>
          </div>
        </div>

        {finalPath ? (
          <p
            className="m-0 w-full min-w-0 px-control-inset text-caption leading-field-compact text-muted text-start wrap-anywhere whitespace-normal"
            title={finalPath}
          >
            {finalPath}
          </p>
        ) : null}

        {visibleNameError ? (
          <Alert className={formError} data-tone="error" id={nameErrorId}>
            {visibleNameError}
          </Alert>
        ) : null}

        {locationError ? (
          <Alert className={formError} data-tone="error" id={locationErrorId}>
            {locationError}
          </Alert>
        ) : null}

        {status ? (
          <Alert className={formError} data-tone="error">
            {status}
          </Alert>
        ) : null}

        <div className="flex min-w-0 justify-center">
          <Button
            busy={isCreating}
            busyStatus="Creating archive…"
            className="min-h-control-standard min-w-archive-create-action cursor-pointer rounded-menu px-overlay-viewport-inset disabled:cursor-not-allowed aria-busy:disabled:cursor-not-allowed archive-form-narrow:w-full archive-form-narrow:min-w-0 archive-form-narrow:whitespace-normal"
            disabled={isCreating}
            type="submit"
            variant="primary"
          >
            Create
          </Button>
        </div>
      </form>
    </section>
  );
}
