import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`CSS block not found: ${header}`);
  const open = source.indexOf("{", start);
  let depth = 0;

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  throw new Error(`CSS block not closed: ${header}`);
}

describe("form semantics and control hit-area contract", () => {
  const forms = read("src/styles/components/forms.css");
  const toggles = read("src/styles/components/toggles.css");
  const base = read("src/styles/base.css");
  const tokens = read("src/styles/tokens.css");
  const buttons = read("src/styles/components/buttons.css");
  const filesystem = read("src/styles/features/filesystem.css");
  const windowFrame = read("src/styles/layout/window-frame.css");
  const forcedColors = read("src/styles/forced-colors.css");
  const archive = read("src/styles/features/archive.css");
  const settings = read("src/styles/features/settings.css");
  const windowTitlebar = read("src/components/WindowTitlebar.tsx");

  it("adds a bounded hard floor to toggles without changing visible geometry", () => {
    const standardToggle = cssBlock(toggles, ".toggle-control");
    const compactToggle = cssBlock(toggles, ".toggle-control--compact");
    const expandedTarget = cssBlock(toggles, ".toggle-control::after");
    const coarsePointer = cssBlock(toggles, "@media (pointer: coarse)");

    expect(standardToggle).toContain("height: var(--toggle-height, 22px)");
    expect(compactToggle).toContain("--toggle-height: 20px");
    expect(expandedTarget).toContain("inset-block: -2px");
    expect(expandedTarget).toContain("inset-inline: 0");
    expect(coarsePointer).toContain("inset-block: -6px");
    expect(coarsePointer).not.toContain("inset-inline");
  });

  it("retains existing compact and native-window target geometry", () => {
    expect(tokens).toContain("--control-height-compact: 32px");
    expect(cssBlock(buttons, ".icon-button--compact")).toContain(
      "--icon-button-size: var(--control-height-compact)",
    );
    const titlebarControls = cssBlock(windowFrame, ".window-titlebar__controls button");
    expect(titlebarControls).toContain("width: 42px");
    expect(titlebarControls).toContain("height: var(--window-titlebar-height)");
    expect(windowTitlebar).toContain("data-tauri-drag-region");
    expect(cssBlock(base, ":where(button, a, summary)")).toContain("touch-action: manipulation");
  });

  it("uses non-color invalid geometry in ordinary and forced-colors modes", () => {
    expect(cssBlock(forms, '.input-shell:has(input[aria-invalid="true"])')).toContain(
      "outline: 2px dashed var(--error-strong)",
    );
    expect(
      cssBlock(forms, '.form-field :where(input, select, textarea)[aria-invalid="true"],'),
    ).toContain("outline: 2px dashed var(--error-strong)");
    expect(cssBlock(filesystem, '.epub-filename-field:has(input[aria-invalid="true"])')).toContain(
      "outline: 2px dashed var(--error-strong)",
    );
    expect(forcedColors).toContain('[role="group"]');
    expect(forcedColors).toContain('.input-shell:has(input[aria-invalid="true"])');
    expect(forcedColors).toContain('.epub-filename-field:has(input[aria-invalid="true"])');
    expect(forcedColors).toContain("outline: 2px dashed Mark");
  });

  it("keeps long errors and constrained forms locally reflowable", () => {
    expect(cssBlock(forms, ".form-error")).toContain("overflow-wrap: anywhere");
    expect(cssBlock(archive, "@container archive-detail (max-width: 360px)")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
    expect(cssBlock(settings, "@container settings-section (max-width: 560px)")).toContain(
      "grid-template-columns: minmax(0, 1fr)",
    );
  });
});
