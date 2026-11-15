import { describe, expect, it } from "vitest";
import { documents } from "./documentationMdxTestSupport";

describe("authored documentation outlines", () => {
  it.each(documents)(
    "$metadata.id preserves unique explicit heading and nonheading anchors",
    (doc) => {
      const ids = [...doc.body.matchAll(/\{#([\w-]+)\}|id="([\w-]+)"/g)].map(
        (match) => match[1] || match[2],
      );
      expect(new Set(ids).size).toBe(ids.length);
      let previous = 1;
      for (const [, hashes] of doc.body.matchAll(/^(#{2,3}) .+ \{#[\w-]+\}$/gm)) {
        expect(hashes.length - previous).toBeLessThanOrEqual(1);
        previous = hashes.length;
      }
    },
  );
});
