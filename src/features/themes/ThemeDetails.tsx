import { SurfacePresence } from "../../components/SurfacePresence";
import { useId } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import type { ThemeManagerController } from "./useThemeManagerController";
import { ThemeShellPreview } from "./ThemeShellPreview";
import { useThemePreview } from "./useThemePreview";

type ThemeDetailsProps = Readonly<{
  controller: ThemeManagerController;
}>;

const paneClass =
  "h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable bg-canvas pb-theme-details-bottom pl-theme-details-left pr-theme-window pt-theme-header-top theme-manager-stacked:pl-theme-window-narrow theme-manager-stacked:pr-theme-window-narrow";
const statusClass = "rounded-pill px-field-compact-inline py-theme-preview-mark";
const copyClass =
  "m-0 max-w-dialog-description wrap-anywhere text-pretty leading-field-standard text-muted";

export function ThemeDetails({ controller }: ThemeDetailsProps) {
  const entry = controller.selectedEntry;
  const titleId = useId();
  const app = useThemePreview(entry);
  const swatches = app
    ? [
        { color: app.publicTokens.main, label: "Main" },
        { color: app.publicTokens.accent, label: "Accent" },
        { color: app.publicTokens.text, label: "Text" },
      ]
    : [];
  if (!entry) {
    return (
      <section className={`${paneClass} grid place-items-center text-muted`}>
        Select a theme to inspect.
      </section>
    );
  }

  const busy = controller.busyAction !== null;
  const actionBlocked = busy || controller.previewActive;
  const selected = controller.activeAppThemeKey === controller.selectedKey;
  const canUse = entry.applicable && entry.capabilities.application;
  const canPreview = entry.origin === "custom" && canUse;
  const author = entry.origin === "custom" ? entry.author : undefined;

  return (
    <section aria-busy={busy || undefined} className={paneClass} aria-labelledby={titleId}>
      <header className="grid grid-cols-theme-catalog-row items-start gap-theme-header-bottom theme-details-stacked:grid-cols-1 theme-details-stacked:gap-theme-header">
        <div className="grid min-w-0 gap-menu-padding">
          <div className="flex min-w-0 flex-wrap items-center gap-theme-catalog-block">
            <h2
              className="m-0 min-w-0 wrap-anywhere text-title-small leading-theme-catalog-status text-text-strong"
              id={titleId}
              title={entry.name ?? entry.id}
            >
              {entry.name ?? entry.id}
            </h2>
            <div className="flex flex-wrap items-center gap-control-gap">
              {selected ? (
                <Badge className={`${statusClass} bg-success-soft text-success`} variant="plain">
                  Selected
                </Badge>
              ) : null}
              {!entry.applicable ? (
                <Badge className={`${statusClass} bg-error-soft text-error-strong`} variant="plain">
                  Invalid
                </Badge>
              ) : null}
            </div>
          </div>
          {author ? <p className={`${copyClass} text-caption-size`}>By {author}</p> : null}
          {entry.description ? (
            <p className={`${copyClass} text-meta-only`}>{entry.description}</p>
          ) : null}
        </div>
        {!controller.previewActive && canUse ? (
          <Button
            className="flex-none theme-details-stacked:justify-self-start"
            disabled={actionBlocked || selected}
            onClick={() => void controller.useSelectedTheme()}
            size="compact"
          >
            Use theme
          </Button>
        ) : null}
      </header>

      {!controller.previewActive ? (
        <div className="mt-theme-header flex flex-wrap items-center gap-control-gap">
          {canPreview ? (
            <Button
              className="rounded-control"
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
              className="rounded-control"
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
        <Alert className="mt-theme-toolbar max-h-theme-diagnostics overflow-auto wrap-normal overscroll-contain rounded-control border-standard border-solid border-error-border bg-error-soft px-sidebar-inset py-theme-catalog-block text-meta-only leading-theme-copy text-error-strong">
          <strong>Theme diagnostics</strong>
          <ul className="mx-0 mb-0 mt-control-gap ps-icon-slot-standard">
            {entry.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.path}-${diagnostic.code}-${index}`}>
                <code className="wrap-anywhere text-inherit">{diagnostic.path}</code>{" "}
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {app ? <ThemeShellPreview theme={app} /> : null}

      {swatches.length ? (
        <dl
          aria-label="Application color preview"
          className="mx-0 mb-0 mt-theme-header-top grid grid-cols-theme-details-swatches gap-x-theme-toolbar gap-y-theme-catalog-block border-0 border-t border-solid border-line-subtle pt-theme-toolbar theme-manager-stacked:grid-cols-1"
        >
          {swatches.map((swatch) => (
            <div
              className="grid min-w-0 grid-cols-theme-swatch items-center gap-control-gap"
              key={swatch.label}
            >
              <dt className="m-0 text-caption text-muted">{swatch.label}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-control-gap-compact">
                <span
                  aria-hidden="true"
                  className="size-collection-utility-icon flex-none rounded-small border-standard border-solid border-line-strong"
                  style={{ backgroundColor: swatch.color }}
                />
                <code className="truncate text-caption-size text-text">{swatch.color}</code>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <SurfacePresence>
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
      </SurfacePresence>
    </section>
  );
}
