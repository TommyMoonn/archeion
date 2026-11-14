import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("website workspace boundaries", () => {
  it("keeps the website private and unversioned with one shared dependency contract", () => {
    const website: unknown = JSON.parse(read("website/package.json"));
    expect(website).toMatchObject({ name: "@archeion/website", private: true });
    expect(website).not.toHaveProperty("version");
    expect(website).not.toHaveProperty("packageManager");
    expect(website).not.toHaveProperty("pnpm");
    expect(read("pnpm-workspace.yaml")).toMatch(/packages:\s*\n\s*- website\s*$/);
    expect(fs.existsSync(path.join(root, "website/pnpm-lock.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(root, "website/package-lock.json"))).toBe(false);
  });

  it.each([
    ["ci.yml", 6],
    ["desktop-build.yml", 1],
    ["coverage.yml", 1],
    ["release.yml", 1],
  ])("installs only application dependencies in existing %s jobs", (workflow, count) => {
    const installs = read(`.github/workflows/${workflow}`).match(/run: pnpm install[^\r\n]*/g);
    const expected = Array(count).fill("run: pnpm install --filter archeion... --frozen-lockfile");
    if (workflow === "ci.yml") {
      expected.push("run: pnpm install --filter @archeion/website... --frozen-lockfile");
    }
    expect(installs?.sort()).toEqual(expected.sort());
  });
});
