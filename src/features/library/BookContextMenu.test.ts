import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getBookMenuClassName } from "./bookContextMenuPlacement";

const styles = readFileSync(new URL("../../styles/features/library.css", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

  if (!match) {
    throw new Error(`Missing CSS block for ${selector}`);
  }

  return match[1];
}

describe("book context menu placement", () => {
  it("requires explicit card and row placement classes", () => {
    expect(getBookMenuClassName("card")).toBe("book-menu book-menu--card");
    expect(getBookMenuClassName("row")).toBe("book-menu book-menu--row");
  });

  it("keeps row actions anchored to the right side of list rows", () => {
    const baseMenu = cssBlock(".book-menu");
    const rowMenu = cssBlock(".book-menu--row");
    const cardMenu = cssBlock(".book-menu--card");

    expect(baseMenu).not.toContain("left:");
    expect(rowMenu).toContain("right: 10px;");
    expect(rowMenu).not.toContain("left:");
    expect(cardMenu).toContain("right: 8px;");
    expect(styles).not.toContain(".book-row .book-menu {");
  });
});
