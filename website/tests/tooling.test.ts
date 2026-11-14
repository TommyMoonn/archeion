import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/utils";

describe("website class composition", () => {
  it("allows consumers to override semantic defaults without losing independent states", () => {
    expect(
      cn("bg-accent px-4 hover:bg-accent-hover", [false, "px-6"], { "bg-control": true }),
    ).toBe("hover:bg-accent-hover px-6 bg-control");
  });
});
