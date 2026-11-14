import { describe, expect, it } from "vitest";
import { cn } from "../website/src/lib/utils";

describe("website class composition", () => {
  it("allows consumers to override semantic defaults without losing independent states", () => {
    expect(
      cn("bg-primary px-4 hover:bg-primary/90", [false, "px-6"], { "bg-secondary": true }),
    ).toBe("hover:bg-primary/90 px-6 bg-secondary");
  });
});
