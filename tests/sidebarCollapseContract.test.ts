import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function cssBlock(source: string, header: string): string {
  const headerIndex = source.indexOf(header);
  if (headerIndex < 0) throw new Error(`CSS block not found: ${header}`);
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

const sidebarSource = read("src/features/library/LibrarySidebar.tsx");
const titlebarActionsSource = read("src/features/library/LibraryTitlebarActions.tsx");
const workspaceSurfaceSource = read("src/features/library/LibraryWorkspaceSurface.tsx");
const sidebarStateSource = read("src/features/library/useLibrarySidebarState.ts");
const shellStyles = read("src/styles/layout/app-shell.css");
const windowTitlebarSource = read("src/components/WindowTitlebar.tsx");
const windowStyles = read("src/styles/layout/window-frame.css");
const forcedColorsStyles = read("src/styles/forced-colors.css");

describe("Phase 0.9.0.6 sidebar collapse contract", () => {
  it("places the one Library collapse action on the native frame outside its drag region", () => {
    expect(windowTitlebarSource).toContain("data-window-titlebar-app-actions");
    expect(windowTitlebarSource).toContain("data-tauri-drag-region");
    expect(titlebarActionsSource).toContain("<WindowTitlebarAppActions>");
    expect(titlebarActionsSource).toContain("<SidebarSimple");
    expect(titlebarActionsSource).not.toMatch(/CaretDouble(?:Left|Right)/);
    expect(`${sidebarSource}\n${titlebarActionsSource}`).not.toMatch(/data-tauri-drag-region/);
    expect(cssBlock(windowStyles, ".window-titlebar__app-actions")).toContain(
      "height: var(--window-titlebar-height)",
    );
  });

  it("uses one session-local owner without adding persisted shell state", () => {
    expect(sidebarStateSource).toContain("useState(false)");
    expect(sidebarStateSource).toContain("useSyncExternalStore");
    expect(`${sidebarStateSource}\n${sidebarSource}\n${titlebarActionsSource}`).not.toMatch(
      /localStorage|sessionStorage|AppPreferences|save|persist/i,
    );
  });

  it("switches to a narrow icon rail without animating shell geometry", () => {
    const collapsedShell = cssBlock(shellStyles, '.app-shell[data-sidebar-collapsed="true"]');
    const collapsedNavigation = cssBlock(shellStyles, '.sidebar[data-collapsed="true"] .nav-item');
    const appShell = cssBlock(shellStyles, ".app-shell");
    const sidebar = cssBlock(shellStyles, ".sidebar");

    expect(collapsedShell).toContain("var(--sidebar-collapsed-width)");
    expect(collapsedNavigation).toContain("grid-template-columns: 1fr");
    expect(collapsedNavigation).toContain("place-items: center");
    expect(`${appShell}\n${sidebar}\n${collapsedShell}`).not.toMatch(/transition|animation/);
  });

  it("keeps the constrained top layout authoritative and hides expanded-only content", () => {
    const constrained = cssBlock(shellStyles, "@media (max-width: 560px)");

    expect(constrained).toMatch(
      /\.app-shell\[data-sidebar-collapsed="true"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    );
    expect(constrained).toMatch(/\.sidebar__expanded-content\s*\{[^}]*display:\s*contents;/s);
    expect(sidebarSource).toMatch(/!isCollapsed[\s\S]*sidebar__expanded-content/);
    expect(workspaceSurfaceSource).toContain("collapseAvailable={sidebarState.collapseAvailable}");
  });

  it("retains normal and forced-colors focus and active-state geometry", () => {
    expect(cssBlock(shellStyles, ".sidebar :where(button, a, summary):focus-visible")).toContain(
      "outline-offset: -2px",
    );
    expect(forcedColorsStyles).toMatch(
      /button,[\s\S]*?\):focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important;/s,
    );
    expect(forcedColorsStyles).toMatch(
      /\.nav-item\.active,[\s\S]*?\)\s*\{[^}]*background:\s*Highlight;/s,
    );
  });
});
