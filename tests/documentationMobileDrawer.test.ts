import { describe, expect, it } from "vitest";
import { documents, sidebarGroups } from "./documentationMdxTestSupport";

describe("shared desktop and mobile documentation destinations", () => {
  it("keeps full accessible article labels and categories for the framework drawer", () => {
    const items = sidebarGroups().flatMap((group) => group.items);
    for (const doc of documents) {
      expect(items.filter((id) => id === doc.metadata.id)).toHaveLength(1);
      expect(doc.metadata.sidebar_label).not.toMatch(/\.\.\.|…/);
      expect(doc.metadata.sidebar_label.trim()).toBeTruthy();
    }
    // Native modality, focus, resize, gesture and route cleanup run against real
    // articles in website-docs-interactions.pw.ts, using the dedicated server.
  });
});
