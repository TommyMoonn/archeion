import { Trash } from "@phosphor-icons/react";
import { useMemo } from "react";

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

  return (
    <section className="theme-details" aria-labelledby="theme-details-title">
      <header className="theme-details__header">
        <h3 id="theme-details-title">{entry.name ?? entry.id}</h3>
        <div className="theme-details__tags">
          {selected ? <span className="theme-details__status">Selected</span> : null}
          {!entry.applicable ? (
            <span className="theme-details__status" data-invalid="true">
              Invalid
            </span>
          ) : null}
        </div>
      </header>

      {entry.origin === "custom" && (entry.author || entry.description) ? (
        <div className="theme-details__metadata">
          {entry.author ? <p>By {entry.author}</p> : null}
          {entry.description ? <p>{entry.description}</p> : null}
        </div>
      ) : null}

      {entry.origin === "custom" && entry.diagnostics.length ? (
        <div className="theme-details__diagnostics" role="alert">
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
        <div className="theme-details__swatches" aria-label="Application color preview">
          {swatches.map((swatch) => (
            <div className="theme-swatch" key={swatch.label}>
              <span aria-hidden="true" style={{ backgroundColor: swatch.color }} />
              <small>{swatch.label}</small>
              <code>{swatch.color}</code>
            </div>
          ))}
        </div>
      ) : null}

      <div className="theme-details__actions">
        {canUse ? (
          <Button
            disabled={actionBlocked || selected}
            onClick={() => void controller.useSelectedTheme()}
          >
            Use this theme
          </Button>
        ) : null}
        {canPreview ? (
          <Button disabled={actionBlocked} onClick={() => controller.preview()} variant="secondary">
            Preview
          </Button>
        ) : null}
        {entry.origin === "custom" ? (
          <Button
            disabled={actionBlocked}
            icon={<Trash aria-hidden="true" />}
            onClick={controller.requestDelete}
            variant="danger"
          >
            Delete
          </Button>
        ) : null}
      </div>

      {controller.pendingDeleteKey === controller.selectedKey ? (
        <Dialog
          closeOnBackdropClick={false}
          description="This removes the theme package from the active archive."
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
                Delete theme
              </Button>
            </>
          }
          onClose={controller.cancelDelete}
          title="Delete theme?"
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
