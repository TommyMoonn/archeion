import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const architectureScript = path.join(projectRoot, "scripts", "check-architecture.mjs");
const architectureProcessTimeout = 15_000;
const temporaryRoots: string[] = [];

function createFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-architecture-"));
  temporaryRoots.push(root);

  for (const [projectPath, contents] of Object.entries(files)) {
    const filePath = path.join(root, ...projectPath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

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

function featureBaseline(
  groups: { from: string; to: string; reason: string; files: [string, string][] }[],
  cyclicDomainPairs: [string, string][] = [],
): string {
  return JSON.stringify({ version: 1, groups, cyclicDomainPairs });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("frontend architecture boundaries", () => {
  it(
    "keeps the current production graph acyclic and within its dependency directions",
    () => {
      const result = runArchitecture(projectRoot, true);
      const report = JSON.parse(result.stdout) as {
        cycleCount: number;
        featureDomainEdgeCount: number;
        featureDomainPairCount: number;
        ok: boolean;
        violations: unknown[];
      };

      expect(result.status).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.cycleCount).toBe(0);
      expect(report.featureDomainEdgeCount).toBeGreaterThan(0);
      expect(report.featureDomainPairCount).toBeGreaterThan(0);
      expect(report.violations).toEqual([]);
    },
    architectureProcessTimeout,
  );

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

  it("rejects a forbidden dependency direction with importer, import, and rule", () => {
    const root = createFixture({
      "src/features/library/libraryModel.ts": "export const libraryModel = true;\n",
      "src/storage/internalStorage.ts": 'import "../features/library/libraryModel";\n',
    });
    const result = runArchitecture(root);

    expect(result.status).not.toBe(0);
    expect(combinedOutput(result)).toContain("ERROR forbidden-direction");
    expect(combinedOutput(result)).toContain("importer: src/storage/internalStorage.ts");
    expect(combinedOutput(result)).toContain("imported: src/features/library/libraryModel.ts");
  });

  it("accepts valid production directions and established Reader-facing contracts", () => {
    const root = createFixture({
      "scripts/feature-domain-baseline.json": featureBaseline([
        {
          from: "reader",
          to: "archive",
          reason: "Reader uses the archive session contract.",
          files: [["ReaderPage.ts", "readerArchiveSession.ts"]],
        },
        {
          from: "reader",
          to: "series",
          reason: "Reader uses the series continuation contract.",
          files: [["ReaderPage.ts", "readerSeriesContinuation.ts"]],
        },
      ]),
      "src/app/root.ts": 'import "../features/reader/ReaderPage";\n',
      "src/features/archive/readerArchiveSession.ts": "export const readerArchiveSession = true;\n",
      "src/features/reader/ReaderPage.ts": [
        'import "../archive/readerArchiveSession";',
        'import "../series/readerSeriesContinuation";',
        'import "../../storage/LibraryStorage";',
        "export const readerPage = true;",
        "",
      ].join("\n"),
      "src/features/series/readerSeriesContinuation.ts":
        "export const readerSeriesContinuation = true;\n",
      "src/storage/LibraryStorage.ts": "export const libraryStorage = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as { ok: boolean; violations: unknown[] };

    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("rejects a new cross-domain import within an already baselined domain pair", () => {
    const root = createFixture({
      "scripts/feature-domain-baseline.json": featureBaseline([
        {
          from: "library",
          to: "folders",
          reason: "Library composes the folder browser.",
          files: [["LibraryPage.ts", "FolderBrowser.ts"]],
        },
      ]),
      "src/features/library/LibraryPage.ts": 'import "../folders/FolderBrowser";\n',
      "src/features/library/NewLibraryAction.ts": 'import "../folders/FolderBrowser";\n',
      "src/features/folders/FolderBrowser.ts": "export const folderBrowser = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      violations: { importer: string; imported: string; rule: string }[];
    };

    expect(result.status).toBe(1);
    expect(report.violations).toEqual([
      expect.objectContaining({
        importer: "src/features/library/NewLibraryAction.ts",
        imported: "src/features/folders/FolderBrowser.ts",
        rule: "unapproved-feature-edge",
      }),
    ]);
  });

  it("rejects a new domain cycle even when its file edges are approved", () => {
    const root = createFixture({
      "scripts/feature-domain-baseline.json": featureBaseline([
        {
          from: "library",
          to: "archive",
          reason: "Library uses the archive API.",
          files: [["root.ts", "api.ts"]],
        },
        {
          from: "archive",
          to: "library",
          reason: "Archive uses the library API.",
          files: [["root.ts", "api.ts"]],
        },
      ]),
      "src/features/library/root.ts": 'import "../archive/api";\n',
      "src/features/archive/root.ts": 'import "../library/api";\n',
      "src/features/library/api.ts": "export const libraryApi = true;\n",
      "src/features/archive/api.ts": "export const archiveApi = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      cycleCount: number;
      featureCycles: string[][];
      violations: { rule: string }[];
    };

    expect(result.status).toBe(1);
    expect(report.cycleCount).toBe(0);
    expect(report.featureCycles).toEqual([["archive", "library", "archive"]]);
    expect(report.violations.map(({ rule }) => rule)).toEqual([
      "new-feature-cycle",
      "new-feature-cycle",
    ]);
  });

  it("requires obsolete edge exceptions to be removed from the baseline", () => {
    const root = createFixture({
      "scripts/feature-domain-baseline.json": featureBaseline([
        {
          from: "library",
          to: "folders",
          reason: "Former folder integration.",
          files: [["LibraryPage.ts", "FolderBrowser.ts"]],
        },
      ]),
      "src/features/library/LibraryPage.ts": "export const libraryPage = true;\n",
      "src/features/folders/FolderBrowser.ts": "export const folderBrowser = true;\n",
    });
    const result = runArchitecture(root);

    expect(result.status).toBe(1);
    expect(combinedOutput(result)).toContain(
      "Stale feature-domain baseline edge: src/features/library/LibraryPage.ts -> src/features/folders/FolderBrowser.ts",
    );
  });

  it("requires obsolete cycle exceptions to be removed from the baseline", () => {
    const root = createFixture({
      "scripts/feature-domain-baseline.json": featureBaseline(
        [
          {
            from: "library",
            to: "folders",
            reason: "Library composes the folder browser.",
            files: [["LibraryPage.ts", "FolderBrowser.ts"]],
          },
        ],
        [["library", "folders"]],
      ),
      "src/features/library/LibraryPage.ts": 'import "../folders/FolderBrowser";\n',
      "src/features/folders/FolderBrowser.ts": "export const folderBrowser = true;\n",
    });
    const result = runArchitecture(root);

    expect(result.status).toBe(1);
    expect(combinedOutput(result)).toContain(
      "Stale cyclic feature-domain baseline pair: library -> folders",
    );
  });

  it("does not baseline same-domain or test-only feature imports", () => {
    const root = createFixture({
      "src/features/library/LibraryPage.ts": 'import "./libraryModel";\n',
      "src/features/library/libraryModel.ts": "export const libraryModel = true;\n",
      "src/features/library/library.test.ts": 'import "../folders/FolderBrowser";\n',
      "src/features/folders/FolderBrowser.ts": "export const folderBrowser = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      featureDomainEdgeCount: number;
      ok: boolean;
      testOnlyEdgeCount: number;
    };

    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.featureDomainEdgeCount).toBe(0);
    expect(report.testOnlyEdgeCount).toBe(1);
  });

  it("finds module dependencies in static, re-exported, dynamic, and CommonJS forms", () => {
    const imports = [
      ["sideEffect.ts", 'import "../features/library/target";'],
      ["named.ts", 'import { target } from "../features/library/target";'],
      ["typeOnly.ts", 'import type { Target } from "../features/library/target";'],
      ["exportNamed.ts", 'export { target } from "../features/library/target";'],
      ["exportStar.ts", 'export * from "../features/library/target";'],
      ["exportType.ts", 'export type { Target } from "../features/library/target";'],
      ["dynamic.tsx", 'void import("../features/library/target");'],
      ["commonJs.cjs", 'const target = require("../features/library/target");'],
      ["importEquals.ts", 'import target = require("../features/library/target");'],
      ["importType.mts", 'type Target = typeof import("../features/library/target");'],
      ["escaped.js", 'import "../features/library/ta\\u0072get";'],
    ] as const;
    const root = createFixture({
      "src/features/library/target.ts":
        "export const target = true; export type Target = boolean;\n",
      ...Object.fromEntries(imports.map(([file, source]) => [`src/storage/${file}`, source])),
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      productionEdgeCount: number;
      violations: { importer: string; imported: string; rule: string }[];
    };

    expect(result.status).toBe(1);
    expect(report.productionEdgeCount).toBe(imports.length);
    expect(report.violations.map(({ importer }) => importer).sort()).toEqual(
      imports.map(([file]) => `src/storage/${file}`).sort(),
    );
    expect(
      report.violations.every(
        ({ imported, rule }) =>
          imported === "src/features/library/target.ts" && rule === "forbidden-direction",
      ),
    ).toBe(true);
  });

  it("ignores import-like text and nonliteral dynamic module expressions", () => {
    const root = createFixture({
      "src/features/library/target.ts": "export const target = true;\n",
      "src/storage/decoys.ts": [
        '// import "../features/library/target";',
        '/* export * from "../features/library/target"; */',
        "const quoted = 'require(\"../features/library/target\")';",
        'const templated = `import("../features/library/target")`;',
        'const importProperty = { import: "../features/library/target" };',
        'const exportProperty = { export: { from: "../features/library/target" } };',
        'const specifier = "../features/library/target";',
        "void import(specifier);",
        "const loader = { import: (_path: string) => {} };",
        'loader.import("../features/library/target");',
        "void import.meta;",
      ].join("\n"),
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      productionEdgeCount: number;
      violations: unknown[];
    };

    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.productionEdgeCount).toBe(0);
    expect(report.violations).toEqual([]);
  });

  it("excludes test-only imports from the production graph", () => {
    const root = createFixture({
      "src/features/library/library.test.ts": 'import "../../storage/internalStorage";\n',
      "src/storage/internalStorage.ts": "export const internalStorage = true;\n",
    });
    const result = runArchitecture(root, true);
    const report = JSON.parse(result.stdout) as {
      ok: boolean;
      productionEdgeCount: number;
      testOnlyEdgeCount: number;
    };

    expect(fs.existsSync(path.join(root, ".project"))).toBe(false);
    expect(result.status).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.productionEdgeCount).toBe(0);
    expect(report.testOnlyEdgeCount).toBe(1);
  });

  it("runs the architecture gate through normal frontend verification", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["architecture:check"]).toBe("node scripts/check-architecture.mjs");
    expect(packageJson.scripts["architecture:baseline"]).toBeUndefined();
    expect(packageJson.scripts["check:frontend"]).toContain("architecture:check");
    expect(packageJson.scripts.check).toBe("npm run check:frontend");
  });
});
