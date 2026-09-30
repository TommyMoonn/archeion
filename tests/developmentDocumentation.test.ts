import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documents = ["docs/DEVELOPMENT.md", "docs/performance/architecture-baseline.md"];

describe("tracked development documentation", () => {
  it("keeps the performance evidence in the repository documentation", () => {
    const guide = fs.readFileSync(path.join(projectRoot, documents[0]), "utf8");
    expect(guide).toContain(
      "[performance architecture baseline](performance/architecture-baseline.md)",
    );
    expect(guide).not.toContain(".project/");
  });

  it.each(documents)("resolves local Markdown links in %s", (document) => {
    const file = path.join(projectRoot, document);
    const markdown = fs.readFileSync(file, "utf8");
    const targets = [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map(([, target]) => target.split("#", 1)[0])
      .filter((target) => target && !/^[a-z][a-z\d+.-]*:/i.test(target));

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(
        fs.existsSync(path.resolve(path.dirname(file), target)),
        `${document}: ${target}`,
      ).toBe(true);
    }
  });
});
