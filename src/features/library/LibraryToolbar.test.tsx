import { describe, expect, it } from "vitest";

import { librarySortOptions } from "./librarySortOptions";

describe("LibraryToolbar", () => {
  it("exposes only the stable normal library sort options", () => {
    expect(librarySortOptions).toEqual([
      { label: "Title", value: "title" },
      { label: "Author", value: "author" },
      { label: "Recently opened", value: "recently-opened" },
    ]);
  });
});
