import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const architectureScript = path.join(projectRoot, "scripts", "check-architecture.mjs");
const temporaryRoots: string[] = [];

const fixtureRules = {
  schemaVersion: 1,
  sourceRoot: "src",
  testFilePatterns: [
    "(?:^|/)test/",
    "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
    "\\.testUtils\\.[cm]?[jt]sx?$",
  ],
  layers: [
    { name: "entry", files: ["src/main.ts"], allowedDependencies: ["app"] },
    {
      name: "app",
      roots: ["src/app"],
      allowedDependencies: [
        "app",
        "components",
        "features",
        "storage",
        "stores",
        "themes",
        "types",
        "utils",
      ],
    },
    {
      name: "features",
      roots: ["src/features"],
      allowedDependencies: [
        "components",
        "features",
        "storage",
        "stores",
        "themes",
        "types",
        "utils",
      ],
    },
    {
      name: "storage",
      roots: ["src/storage"],
      allowedDependencies: ["storage", "stores", "types", "utils"],
    },
    {
      name: "stores",
      roots: ["src/stores"],
      allowedDependencies: ["storage", "stores", "types", "utils"],
    },
    {
      name: "themes",
      roots: ["src/themes"],
      allowedDependencies: ["storage", "stores", "themes", "types", "utils"],
    },
    {
      name: "components",
      roots: ["src/components"],
      allowedDependencies: ["components", "types", "utils"],
    },
    { name: "types", roots: ["src/types"], allowedDependencies: ["types"] },
    { name: "utils", roots: ["src/utils"], allowedDependencies: ["types", "utils"] },
  ],
  restrictedDirections: [
    {
      from: "app",
      to: "features",
      rule: "non-public-feature-entry",
      hint: "Use a declared feature entry point.",
      crossFeatureOnly: false,
    },
    {
      from: "features",
      to: "storage",
      rule: "non-public-storage-entry",
      hint: "Use a declared storage port.",
      crossFeatureOnly: false,
    },
    {
      from: "features",
      to: "features",
      rule: "cross-feature-internal",
      hint: "Use a declared feature public API.",
      crossFeatureOnly: true,
    },
  ],
  publicModules: [],
  advisories: {
    fanOutThreshold: 20,
    lineCountThreshold: 600,
    lineGrowthNotice: 50,
    fanOutGrowthNotice: 3,
    reportLimit: 10,
  },
};

type BoundaryException = {
  id: string;
  importer: string;
  imported: string;
  rule: string;
  reason: string;
  owner: { plan: string; phase: string };
  removalCondition: string;
};

function createFixture(
  files: Record<string, string>,
  exceptions: BoundaryException[] = [],
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-architecture-"));
  temporaryRoots.push(root);

  for (const [projectPath, contents] of Object.entries(files)) {
    const filePath = path.join(root, ...projectPath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  const architectureRoot = path.join(root, ".project", "architecture");
  fs.mkdirSync(architectureRoot, { recursive: true });
  fs.writeFileSync(
    path.join(architectureRoot, "frontend-boundaries.json"),
    `${JSON.stringify(fixtureRules, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(architectureRoot, "frontend-boundary-exceptions.json"),
    `${JSON.stringify({ schemaVersion: 1, exceptions }, null, 2)}\n`,
  );

  return root;
}

function runArchitecture(root: string, json = false) {
  return spawnSync(
    process.execPath,
    [architectureScript, "--project-root", root, ...(json ? ["--json"] : [])],
    {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function combinedOutput(result: ReturnType<typeof runArchitecture>): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function temporaryException(importer: string, imported: string, rule: string): BoundaryException {
  return {
    id: "fixture-exception",
    importer,
    imported,
    rule,
    reason: "Fixture-owned temporary dependency.",
    owner: {
      plan: ".planning/01_FRONTEND_ARCHITECTURE_MAINTAINABILITY_PLAN.md",
      phase: "Phase 4",
    },
    removalCondition: "Remove when the fixture adopts a public contract.",
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("frontend architecture boundaries", () => {
  it("keeps the current production graph acyclic and fully accounted for", () => {
    const result = runArchitecture(projectRoot, true);
    const report = JSON.parse(result.stdout) as {
      cycleCount: number;
      ok: boolean;
      staleExceptions: unknown[];
      usedExceptionCount: number;
      violations: unknown[];
    };

    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.cycleCount).toBe(0);
    expect(report.violations).toEqual([]);
    expect(report.staleExceptions).toEqual([]);
    expect(report.usedExceptionCount).toBeGreaterThan(0);
  });

  it("fails a cycle with the complete local path", () => {
    const root = createFixture({
      "src/app/a.ts": 'import "./b";\n',
      "src/app/b.ts": 'import "./a";\n',
    });
    const result = runArchitecture(root);

    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toContain("ERROR cycle");
    expect(combinedOutput(result)).toContain("src/app/a.ts -> src/app/b.ts -> src/app/a.ts");
  });

  it("rejects feature access to storage internals and storage access to features", () => {
    const root = createFixture({
      "src/features/library/useArchiveData.ts": 'import "../../storage/internalStorage";\n',
      "src/storage/internalStorage.ts": 'import "../features/library/libraryModel";\n',
      "src/features/library/libraryModel.ts": "export const libraryModel = true;\n",
    });
    const result = runArchitecture(root);

    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toContain("ERROR non-public-storage-entry");
    expect(combinedOutput(result)).toContain("ERROR forbidden-direction");
    expect(combinedOutput(result)).toContain("src/storage/internalStorage.ts");
  });

  it("approves only the exact declared temporary edge", () => {
    const importer = "src/features/library/useSeries.ts";
    const imported = "src/features/series/seriesModel.ts";
    const root = createFixture(
      {
        [importer]: 'import "../series/seriesModel";\n',
        [imported]: "export const seriesModel = true;\n",
      },
      [temporaryException(importer, imported, "cross-feature-internal")],
    );

    const approved = runArchitecture(root);
    expect(approved.status).toBe(0);

    fs.writeFileSync(
      path.join(root, "src", "features", "library", "useSeries.ts"),
      'import "../series/replacementModel";\n',
    );
    fs.writeFileSync(
      path.join(root, "src", "features", "series", "replacementModel.ts"),
      "export const replacementModel = true;\n",
    );

    const changed = runArchitecture(root);
    expect(changed.status).not.toBe(0);
    expect(combinedOutput(changed)).toContain("ERROR cross-feature-internal");
    expect(combinedOutput(changed)).toContain("ERROR stale-exception");
  });

  it("classifies test-only imports without weakening production rules", () => {
    const root = createFixture({
      "src/features/library/library.test.ts": 'import "../../storage/internalStorage";\n',
      "src/storage/internalStorage.ts": "export const internalStorage = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      testOnlyEdgeCount: number;
      usedExceptionCount: number;
    };

    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.testOnlyEdgeCount).toBe(1);
    expect(report.usedExceptionCount).toBe(0);
  });

  it("runs the architecture gate through the normal verification command", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["architecture:check"]).toBe("node scripts/check-architecture.mjs");
    expect(packageJson.scripts.check).toContain("architecture:check");
  });
});
