import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "../src/components/Button";
import { adaptiveLayoutLongContent } from "./fixtures/adaptiveLayoutLongContent";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escapedHeader}\\s*\\{`).exec(source);
  if (!match) throw new Error(`CSS block not found: ${header}`);
  const headerIndex = match.index + (match[0].startsWith("\n") ? 1 : 0);
  const openingBrace = source.indexOf("{", headerIndex + header.length);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${header}`);
}

const library = read("src/styles/features/library.css");
const folders = read("src/styles/features/folders.css");
const series = read("src/styles/features/series.css");
const settings = read("src/styles/features/settings.css");
const archive = read("src/styles/features/archive.css");
const reader = read("src/styles/features/reader.css");
const dialogs = read("src/styles/components/dialogs.css");
const statusPage = read("src/styles/components/status-page.css");
const shell = read("src/styles/layout/app-shell.css");
const buttons = read("src/components/Button.tsx");
const folderBrowser = read("src/features/folders/FolderBrowser.tsx");
const seriesOverview = read("src/features/series/SeriesOverview.tsx");
const themeCatalog = read("src/features/themes/ThemeCatalogList.tsx");
const forcedColors = read("src/styles/forced-colors.css");

describe("Phase 0.9.0.25 adaptive layout and content growth contract", () => {
  it("keeps a bounded pseudolocalized fixture for every audited long-content class", () => {
    expect(Object.keys(adaptiveLayoutLongContent)).toEqual([
      "archiveName",
      "bookTitle",
      "buttonLabel",
      "disabledReason",
      "errorMessage",
      "folderName",
      "folderPath",
      "seriesTitle",
      "shortcutLabel",
      "themeName",
    ]);

    for (const value of Object.values(adaptiveLayoutLongContent)) {
      expect(value.length).toBeGreaterThan(70);
      expect(value.length).toBeLessThan(140);
    }
  });

  it("adapts reusable control groups to their owning containers", () => {
    expect(cssBlock(library, ".library-header")).toContain("container-name: collection-header");
    expect(cssBlock(library, "@container collection-header (max-width: 560px)")).toContain(
      ".library-header__actions",
    );
    expect(cssBlock(settings, ".settings-section")).toContain("container-name: settings-section");
    expect(cssBlock(settings, "@container settings-section (max-width: 560px)")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(cssBlock(dialogs, ".dialog__panel")).toContain("container-name: dialog-panel");
    expect(cssBlock(dialogs, "@container dialog-panel (max-width: 320px)")).toContain(
      "white-space: normal",
    );
    expect(cssBlock(archive, ".archive-manager-window__content-area")).toContain(
      "container-name: archive-detail",
    );
    expect(cssBlock(archive, "@container archive-detail (max-width: 360px)")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(cssBlock(reader, ".reader-annotations__controls")).toContain(
      "container-name: reader-tools",
    );
    expect(cssBlock(reader, "@container reader-tools (max-width: 320px)")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
  });

  it("lets essential text and dialog actions grow before they can overlap", () => {
    const constrainedDialog = cssBlock(dialogs, "@container dialog-panel (max-width: 320px)");
    const constrainedSettings = cssBlock(
      settings,
      "@container settings-section (max-width: 560px)",
    );
    const constrainedArchive = cssBlock(archive, "@container archive-detail (max-width: 360px)");

    expect(constrainedDialog).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(constrainedDialog).toContain("width: 100%");
    expect(constrainedDialog).toContain("white-space: normal");
    expect(constrainedSettings).toContain("overflow-wrap: anywhere");
    expect(constrainedSettings).toContain("white-space: normal");
    expect(constrainedArchive).toContain("overflow-wrap: anywhere");
    expect(
      cssBlock(
        statusPage,
        ".reader-status-page p,\n.reader-error p,\n.status-page > p:not(.status-page__code)",
      ),
    ).toContain("overflow-wrap: anywhere");
  });

  it("retains complete accessible content when visual labels truncate", () => {
    const explainedDisabledButton = renderToStaticMarkup(
      createElement(
        Button,
        {
          disabled: true,
          disabledReason: adaptiveLayoutLongContent.disabledReason,
        },
        adaptiveLayoutLongContent.buttonLabel,
      ),
    );

    expect(folderBrowser).toContain("<strong>{folder.name}</strong>");
    expect(folderBrowser).toContain("<small>{displayPath}</small>");
    expect(seriesOverview).toContain("aria-label={`Open ${entry.displayName}`}");
    expect(seriesOverview).toContain("<strong>{entry.displayName}</strong>");
    expect(themeCatalog).toContain("{entry.name ?? entry.id}");
    expect(buttons).toContain("{disabledReason}");
    expect(buttons).toContain("aria-describedby");
    expect(buttons).not.toContain("title={disabledReason}");
    expect(explainedDisabledButton).toContain(adaptiveLayoutLongContent.buttonLabel);
    expect(explainedDisabledButton).toContain(adaptiveLayoutLongContent.disabledReason);
    expect(explainedDisabledButton).toContain('aria-disabled="true"');
    expect(explainedDisabledButton).toContain("aria-describedby");
  });

  it("uses logical reading-direction properties without changing established LTR values", () => {
    expect(cssBlock(shell, ".sidebar")).toMatch(
      /padding-block:\s*12px;\s*padding-inline:\s*12px 4px;/,
    );
    expect(cssBlock(shell, ".nav-item")).toContain("text-align: start");
    expect(cssBlock(folders, ".folder-tree__children")).toContain("padding-inline-start: 11px");
    expect(cssBlock(series, ".series-card__open")).toContain("text-align: start");
    expect(cssBlock(settings, ".settings-sidebar")).toContain("border-inline-end");
    expect(cssBlock(library, ".details-drawer")).toContain("border-inline-start");
  });

  it("pairs trailing controls with logical content reservations", () => {
    const folderList = cssBlock(folders, ".folder-browser__items--list .folder-browser__open");
    const folderCards = cssBlock(folders, ".folder-browser__items--cards .folder-browser__open");
    const folderActions = cssBlock(folders, ".folder-browser__item-actions");
    const bookRow = cssBlock(library, ".book-row__select");
    const bookMenu = cssBlock(library, ".book-menu--row");
    const bookRename = cssBlock(library, ".book-row__rename");
    const constrainedShell = cssBlock(shell, "@media (max-width: 820px)");
    const constrainedNavigation = cssBlock(constrainedShell, "  .nav-item");

    expect(folderList).toContain("padding-block: 0");
    expect(folderList).toContain("padding-inline: 10px 88px");
    expect(folderCards).toContain("padding-block: 17px");
    expect(folderCards).toContain("padding-inline: 17px 82px");
    expect(folderActions).toContain("inset-inline-end: 8px");
    expect(bookRow).toContain("padding-block: 9px");
    expect(bookRow).toContain("padding-inline: 10px 124px");
    expect(bookRename).toContain("inset-inline-end: 78px");
    expect(library).toMatch(/\.book-row__favorite\s*\{\s*inset-inline-end:\s*45px;\s*\}/);
    expect(bookMenu).toContain("inset-inline-end: 10px");
    expect(constrainedNavigation).toContain("padding-block: 0");
    expect(constrainedNavigation).toContain("padding-inline: 9px 0");

    expect(folderList).not.toContain("padding: 0 88px 0 10px");
    expect(folderCards).not.toContain("padding: 17px 82px 17px 17px");
    expect(bookRow).not.toContain("padding: 9px 124px 9px 10px");
    expect(bookMenu).not.toContain("right: 10px");
    expect(constrainedNavigation).not.toContain("padding: 0 0 0 9px");
  });

  it("keeps horizontal overflow at bounded local owners and preserves non-hover access", () => {
    expect(cssBlock(shell, ".app-shell")).toContain("overflow: hidden");
    expect(cssBlock(shell, ".sidebar__folder-scroll")).toContain("overflow-x: hidden");
    expect(cssBlock(reader, ".reader-settings__body")).toContain("overflow-y: auto");
    expect(cssBlock(archive, ".archive-manager-window")).toContain("overflow: hidden");
    expect(folders).toContain(".folder-browser__item-actions");
    expect(folders).not.toMatch(/\.folder-browser__item-actions\s*\{[^}]*opacity:\s*0/s);
    expect(forcedColors).toContain(".reader-side-panel");
    expect(forcedColors).toContain(".archive-manager-window");
  });
});
