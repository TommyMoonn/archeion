import { FolderOpen, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  resolveBuiltInAppTheme,
  resolveBuiltInReaderTheme,
  resolveTheme,
} from "../../themes/resolveTheme";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import type { ThemePreviewChannels } from "../../themes/ThemePreviewSession";
import type { ThemeManagerController } from "./useThemeManagerController";

type PreviewTarget = "application" | "both" | "reader";

type ThemeDetailsProps = Readonly<{
  controller: ThemeManagerController;
  onChooseReplacement: () => void;
}>;

export function ThemeDetails({ controller, onChooseReplacement }: ThemeDetailsProps) {
  const entry = controller.selectedEntry;
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>("application");
  const swatches = useMemo(() => (entry ? themeSwatches(entry) : []), [entry]);
  if (!entry) {
    return (
      <section className="theme-details theme-details--empty">Select a theme to inspect.</section>
    );
  }

  const busy = controller.busyAction !== null;
  const actionBlocked = busy || controller.previewActive;
  const canPreview = entry.origin === "custom" && entry.applicable;
  const previewOptions = previewTargetOptions(entry);
  const resolvedPreviewTarget = previewOptions.some((option) => option.value === previewTarget)
    ? previewTarget
    : previewOptions[0]?.value;

  return (
    <section className="theme-details" aria-labelledby="theme-details-title">
      <header className="theme-details__header">
        <div>
          <p>{entry.origin === "builtin" ? "Built-in theme" : `Package ${entry.packageId}`}</p>
          <h3 id="theme-details-title">{entry.name ?? entry.id}</h3>
        </div>
        <span className="theme-details__status" data-invalid={!entry.applicable || undefined}>
          {entry.applicable ? "Ready" : "Invalid"}
        </span>
      </header>

      {entry.origin === "custom" ? (
        <dl className="theme-details__metadata">
          {entry.author ? (
            <>
              <dt>Author</dt>
              <dd>{entry.author}</dd>
            </>
          ) : null}
          {entry.description ? (
            <>
              <dt>Description</dt>
              <dd>{entry.description}</dd>
            </>
          ) : null}
          <dt>Capabilities</dt>
          <dd>{capabilityLabel(entry)}</dd>
        </dl>
      ) : (
        <p className="theme-details__description">
          Included with Archeion and available in every archive.
        </p>
      )}

      {entry.origin === "custom" && entry.diagnostics.length ? (
        <div className="theme-details__diagnostics" role="alert">
          <strong>Package diagnostics</strong>
          <ul>
            {entry.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.path}-${diagnostic.code}-${index}`}>
                <code>{diagnostic.path}</code> {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {swatches.length ? (
        <div className="theme-details__swatches" aria-label="Theme color preview">
          {swatches.map((swatch) => (
            <div className="theme-swatch" key={`${swatch.scope}-${swatch.label}`}>
              <span aria-hidden="true" style={{ backgroundColor: swatch.color }} />
              <small>{swatch.label}</small>
              <code>{swatch.color}</code>
            </div>
          ))}
        </div>
      ) : null}

      {entry.applicable ? (
        <div className="theme-details__apply-actions">
          <Button
            disabled={actionBlocked || !entry.capabilities.application}
            onClick={() => void controller.applyTo("application")}
            size="standard"
          >
            Apply to application
          </Button>
          <Button
            disabled={actionBlocked || !entry.capabilities.reader}
            onClick={() => void controller.applyTo("reader")}
            size="standard"
            variant="secondary"
          >
            Apply to reader
          </Button>
        </div>
      ) : null}

      {canPreview && resolvedPreviewTarget ? (
        <div className="theme-details__preview-action">
          <AppSelect
            ariaLabel="Preview target"
            onChange={setPreviewTarget}
            options={previewOptions}
            size="compact"
            value={resolvedPreviewTarget}
          />
          <Button
            disabled={busy || controller.previewActive}
            onClick={() => controller.preview(previewChannels(resolvedPreviewTarget))}
            size="standard"
            variant="secondary"
          >
            Preview
          </Button>
        </div>
      ) : null}

      {entry.origin === "custom" ? (
        <div className="theme-details__package-actions">
          <Button
            disabled={actionBlocked}
            icon={<FolderOpen aria-hidden="true" />}
            onClick={() => void controller.reveal("package")}
            size="standard"
            variant="ghost"
          >
            Reveal package
          </Button>
          <Button
            disabled={actionBlocked}
            onClick={onChooseReplacement}
            size="standard"
            variant="ghost"
          >
            Replace
          </Button>
          <Button
            disabled={actionBlocked}
            icon={<Trash aria-hidden="true" />}
            onClick={controller.requestDelete}
            size="standard"
            variant="danger"
          >
            Delete
          </Button>
        </div>
      ) : null}

      {controller.pendingDeleteKey === controller.selectedKey ? (
        <Dialog
          closeOnBackdropClick={false}
          description="If this package is selected, Archeion retains its stored ID and safely falls back until it is restored or another theme is selected."
          footer={
            <>
              <Button onClick={controller.cancelDelete} size="standard" variant="secondary">
                Cancel
              </Button>
              <Button
                onClick={() => void controller.confirmDelete()}
                size="standard"
                variant="danger"
              >
                Delete package
              </Button>
            </>
          }
          onClose={controller.cancelDelete}
          title="Delete theme package?"
        >
          {controller.error ? <p role="alert">{controller.error}</p> : null}
        </Dialog>
      ) : null}
    </section>
  );
}

function previewTargetOptions(
  entry: ThemeCatalogEntry,
): Array<{ label: string; value: PreviewTarget }> {
  if (!entry.capabilities.reader) return [{ label: "Application", value: "application" }];
  return [
    { label: "Application + reader", value: "both" },
    { label: "Application", value: "application" },
    { label: "Reader", value: "reader" },
  ];
}

function previewChannels(target: PreviewTarget): ThemePreviewChannels {
  return {
    application: target === "application" || target === "both",
    reader: target === "reader" || target === "both",
  };
}

function capabilityLabel(entry: ThemeCatalogEntry): string {
  if (entry.capabilities.application && entry.capabilities.reader) return "Application and reader";
  if (entry.capabilities.reader) return "Reader only";
  if (entry.capabilities.application) return "Application only";
  return "Unavailable";
}

function themeSwatches(entry: ThemeCatalogEntry) {
  if (entry.origin === "custom" && !entry.applicable) return [];
  const customResolved = entry.origin === "custom" ? resolveTheme(entry.manifest) : undefined;
  const app =
    entry.origin === "builtin"
      ? entry.appBase
        ? resolveBuiltInAppTheme(entry.appBase)
        : undefined
      : customResolved?.app;
  const reader =
    entry.origin === "builtin"
      ? entry.readerBase
        ? resolveBuiltInReaderTheme(entry.readerBase)
        : undefined
      : customResolved?.reader;
  return [
    ...(app
      ? [
          { color: app.publicTokens.main, label: "App", scope: "app" },
          { color: app.publicTokens.accent, label: "Accent", scope: "app" },
          { color: app.publicTokens.text, label: "Text", scope: "app" },
        ]
      : []),
    ...(reader
      ? [
          { color: reader.publicTokens.background, label: "Reader", scope: "reader" },
          { color: reader.publicTokens.link, label: "Link", scope: "reader" },
          { color: reader.publicTokens.text, label: "Reader text", scope: "reader" },
        ]
      : []),
  ];
}
