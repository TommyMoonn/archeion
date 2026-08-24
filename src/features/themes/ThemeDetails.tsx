import { useId, useMemo } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { resolveBuiltInAppTheme, resolveTheme } from "../../themes/resolveTheme";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import type { ThemeManagerController } from "./useThemeManagerController";

type ThemeDetailsProps = Readonly<{
  controller: ThemeManagerController;
}>;

export function ThemeDetails({ controller }: ThemeDetailsProps) {
  const entry = controller.selectedEntry;
  const titleId = useId();
  const swatches = useMemo(() => (entry ? applicationSwatches(entry) : []), [entry]);
  if (!entry) {
    return (
      <section className="theme-details theme-details--empty">Select a theme to inspect.</section>
    );
  }

  const busy = controller.busyAction !== null;
  const actionBlocked = busy || controller.previewActive;
  const selected = controller.activeAppThemeKey === controller.selectedKey;
  const canUse = entry.applicable && entry.capabilities.application;
  const canPreview = entry.origin === "custom" && canUse;
  const author = entry.origin === "custom" ? entry.author : undefined;

  return (
    <section className="theme-details" aria-labelledby={titleId}>
      <header className="theme-details__header">
        <div className="theme-details__header-copy">
          <div className="theme-details__title-row">
            <h2 id={titleId} title={entry.name ?? entry.id}>
              {entry.name ?? entry.id}
            </h2>
            <div className="theme-details__tags">
              {selected ? <span className="theme-details__status">Selected</span> : null}
              {!entry.applicable ? (
                <span className="theme-details__status" data-invalid="true">
                  Invalid
                </span>
              ) : null}
            </div>
          </div>
          {author ? <p className="theme-details__author">By {author}</p> : null}
          {entry.description ? (
            <p className="theme-details__description">{entry.description}</p>
          ) : null}
        </div>
        {!controller.previewActive && canUse ? (
          <Button
            className="theme-details__primary-action"
            disabled={actionBlocked || selected}
            onClick={() => void controller.useSelectedTheme()}
            size="compact"
          >
            Use theme
          </Button>
        ) : null}
      </header>

      {!controller.previewActive ? (
        <div className="theme-details__actions">
          {canPreview ? (
            <Button
              className="theme-details__action"
              disabled={actionBlocked}
              onClick={() => controller.preview()}
              size="compact"
              variant="secondary"
            >
              Preview
            </Button>
          ) : null}
          {entry.origin === "custom" ? (
            <Button
              className="theme-details__action"
              disabled={actionBlocked}
              onClick={controller.requestDelete}
              size="compact"
              variant="danger"
            >
              Remove
            </Button>
          ) : null}
        </div>
      ) : null}

      {entry.origin === "custom" && entry.diagnostics.length ? (
        <div className="theme-details__diagnostics" data-tone="error" role="alert">
          <strong>Theme diagnostics</strong>
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
        <dl className="theme-details__swatches" aria-label="Application color preview">
          {swatches.map((swatch) => (
            <div className="theme-swatch" key={swatch.label}>
              <dt>{swatch.label}</dt>
              <dd>
                <span aria-hidden="true" style={{ backgroundColor: swatch.color }} />
                <code>{swatch.color}</code>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {controller.pendingDeleteKey === controller.selectedKey ? (
        <Dialog
          closeOnBackdropClick={false}
          description="This removes the theme package from Archeion."
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
                Remove theme
              </Button>
            </>
          }
          onClose={controller.cancelDelete}
          title={`Remove “${entry.name ?? entry.id}” theme?`}
        />
      ) : null}
    </section>
  );
}

function applicationSwatches(entry: ThemeCatalogEntry) {
  if (!entry.applicable) return [];
  const app =
    entry.origin === "builtin"
      ? entry.appBase
        ? resolveBuiltInAppTheme(entry.appBase)
        : null
      : resolveTheme(entry.manifest).app;
  if (!app) return [];
  return [
    { color: app.publicTokens.main, label: "Main" },
    { color: app.publicTokens.accent, label: "Accent" },
    { color: app.publicTokens.text, label: "Text" },
  ];
}
