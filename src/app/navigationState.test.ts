import { describe, expect, it } from "vitest";

import { rememberedNavigationForLocation } from "./navigationState";

describe("remembered navigation", () => {
  it("stores an archive-aware canonical reader route", () => {
    expect(rememberedNavigationForLocation({ pathname: "/reader/book%201" }, "archive-1")).toEqual({
      archiveId: "archive-1",
      bookId: "book 1",
      lastRoute: "/reader/book%201",
    });
  });

  it("clears remembered reader state on library routes", () => {
    expect(rememberedNavigationForLocation({ pathname: "/" }, "archive-1")).toBeNull();
  });
});
