import { expect, it } from "vitest";
import { cn } from "./cn";

it("preserves independent semantic text and border roles", () => {
  expect(
    cn(
      "text-body text-text border-standard border-solid border-line",
      "text-meta text-muted border-accent",
    ),
  ).toBe("border-standard border-solid text-meta text-muted border-accent");
});

it("merges named control dimensions without dropping other geometry", () => {
  expect(
    cn(
      "size-control-standard rounded-control gap-control-gap px-button-standard",
      "size-control-compact gap-control-gap-compact px-button-compact",
    ),
  ).toBe("rounded-control size-control-compact gap-control-gap-compact px-button-compact");
});
