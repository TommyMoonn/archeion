import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const testFilePatterns = [
  /(?:^|\/)test\//,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /\.testUtils\.[cm]?[jt]sx?$/,
];

const layers = [
  { name: "entry", files: ["src/main.tsx"], allowedDependencies: ["app"] },
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
  {
    name: "test-support",
    roots: ["src/test"],
    allowedDependencies: [
      "app",
      "components",
      "features",
      "storage",
      "stores",
      "themes",
      "types",
      "utils",
      "test-support",
    ],
  },
  {
    name: "types",
    files: ["src/vite-env.d.ts"],
    roots: ["src/types"],
    allowedDependencies: ["types"],
  },
  { name: "utils", roots: ["src/utils"], allowedDependencies: ["types", "utils"] },
];

const publicCrossLayerModules = new Map([
  ["src/app/appVersion.ts", new Set(["features"])],
  ["src/app/inputModality.ts", new Set(["components", "features", "utils"])],
  ["src/app/navigationState.ts", new Set(["features"])],
  ["src/app/openExternalUrl.ts", new Set(["features"])],
  ["src/app/readerReturnContext.ts", new Set(["features"])],
  ["src/app/router.tsx", new Set(["features"])],
  ["src/app/startupController.ts", new Set(["features"])],
  ["src/app/startupTrace.ts", new Set(["features"])],
  ["src/app/useAsyncRouteLeaveGuard.ts", new Set(["features"])],
  ["src/app/windowMode.ts", new Set(["features"])],
  ["src/components/SkipLink.tsx", new Set(["storage"])],
  ["src/features/commands/commandBindings.ts", new Set(["stores"])],
]);

function parseArguments(argv) {
  const options = {
    projectRoot: defaultProjectRoot,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--project-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--project-root requires a path.");
      options.projectRoot = path.resolve(value);
      index += 1;
      continue;
    }

    if (argument === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function normalizeProjectPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isSourceFile(filePath) {
  return sourceExtensions.some((extension) => filePath.endsWith(extension));
}

function readModuleSpecifiers(filePath) {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = new Set();

  function addStringLiteral(node) {
    if (node && ts.isStringLiteral(node)) specifiers.add(node.text);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addStringLiteral(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      addStringLiteral(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return [...specifiers];
}

function resolveLocalModule(importerPath, specifier) {
  if (!specifier.startsWith(".")) return { kind: "external" };

  const importerDirectory = path.dirname(importerPath);
  const unresolvedBase = path.resolve(importerDirectory, specifier);
  const candidates = [];

  if (sourceExtensions.some((extension) => unresolvedBase.endsWith(extension))) {
    candidates.push(unresolvedBase);
  } else {
    for (const extension of sourceExtensions) candidates.push(`${unresolvedBase}${extension}`);
    for (const extension of sourceExtensions) {
      candidates.push(path.join(unresolvedBase, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { kind: "source", filePath: candidate };
    }
  }

  if (fs.existsSync(unresolvedBase)) return { kind: "asset" };

  const explicitExtension = path.extname(unresolvedBase);
  if (explicitExtension && !sourceExtensions.includes(explicitExtension)) {
    return { kind: "asset" };
  }

  return { kind: "unresolved" };
}

function classifyModule(projectPath) {
  for (const layer of layers) {
    const exactFiles = layer.files ?? [];
    if (exactFiles.includes(projectPath)) {
      return { layer: layer.name };
    }

    for (const root of layer.roots ?? []) {
      if (projectPath === root || projectPath.startsWith(`${root}/`)) {
        const featureDomain =
          layer.name === "features"
            ? /^src\/features\/([^/]+)\//.exec(projectPath)?.[1]
            : undefined;
        return { layer: layer.name, featureDomain };
      }
    }
  }

  return null;
}

function edgeKey(importer, imported) {
  return `${importer}\u0000${imported}`;
}

function readFeatureBaseline(projectRoot) {
  const baselinePath = path.join(projectRoot, "scripts", "feature-domain-baseline.json");
  if (!fs.existsSync(baselinePath)) {
    return { allowedEdges: new Set(), allowedCyclicPairs: new Set() };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (baseline.version !== 1 || !Array.isArray(baseline.groups)) {
    throw new Error("Invalid feature-domain baseline: expected version 1 and groups array.");
  }
  if (!Array.isArray(baseline.cyclicDomainPairs)) {
    throw new Error("Invalid feature-domain baseline: expected cyclicDomainPairs array.");
  }

  const allowedEdges = new Set();
  const groupPairs = new Set();
  for (const group of baseline.groups) {
    const { from, to, reason, files } = group;
    const validDomain = (value) => typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
    if (
      !validDomain(from) ||
      !validDomain(to) ||
      from === to ||
      typeof reason !== "string" ||
      !reason.trim() ||
      !Array.isArray(files) ||
      files.length === 0
    ) {
      throw new Error("Invalid feature-domain baseline group.");
    }

    const pair = edgeKey(from, to);
    if (groupPairs.has(pair))
      throw new Error(`Duplicate feature-domain baseline group: ${from} -> ${to}.`);
    groupPairs.add(pair);

    for (const filesPair of files) {
      if (!Array.isArray(filesPair) || filesPair.length !== 2) {
        throw new Error(`Invalid feature-domain baseline file pair: ${from} -> ${to}.`);
      }
      for (const relativePath of filesPair) {
        if (
          typeof relativePath !== "string" ||
          relativePath
            .split("/")
            .some((segment) => !segment || segment === "." || segment === "..") ||
          relativePath.includes("\\")
        ) {
          throw new Error(`Invalid feature-domain baseline path: ${relativePath}.`);
        }
      }
      const key = edgeKey(
        `src/features/${from}/${filesPair[0]}`,
        `src/features/${to}/${filesPair[1]}`,
      );
      if (allowedEdges.has(key)) {
        throw new Error(
          `Duplicate feature-domain baseline edge: ${key.replace("\u0000", " -> ")}.`,
        );
      }
      allowedEdges.add(key);
    }
  }

  const allowedCyclicPairs = new Set();
  for (const pair of baseline.cyclicDomainPairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !groupPairs.has(edgeKey(...pair))) {
      throw new Error(`Invalid cyclic feature-domain baseline pair: ${JSON.stringify(pair)}.`);
    }
    const key = edgeKey(...pair);
    if (allowedCyclicPairs.has(key)) {
      throw new Error(`Duplicate cyclic feature-domain baseline pair: ${pair.join(" -> ")}.`);
    }
    allowedCyclicPairs.add(key);
  }

  return { allowedEdges, allowedCyclicPairs };
}

function isPublicCrossLayerModule(importer, imported) {
  return publicCrossLayerModules.get(imported.path)?.has(importer.classification.layer) ?? false;
}

function evaluateEdge(importer, imported) {
  if (imported.isTest) {
    return {
      rule: "production-imports-test",
      hint: [
        "Move the shared contract into production code or keep the dependency inside",
        "the test graph.",
      ].join(" "),
    };
  }

  if (isPublicCrossLayerModule(importer, imported)) return null;

  const importerLayer = layers.find((layer) => layer.name === importer.classification.layer);
  const allowedDependencies = importerLayer?.allowedDependencies ?? [];
  if (!allowedDependencies.includes(imported.classification.layer)) {
    return {
      rule: "forbidden-direction",
      hint:
        `Move the dependency behind a ${imported.classification.layer} public contract ` +
        "or invert the integration at the owning layer.",
    };
  }

  return null;
}

function findCycles(nodes, edges) {
  const adjacency = new Map([...nodes].map((node) => [node, []]));
  for (const edge of edges) adjacency.get(edge.importer)?.push(edge.imported);
  for (const neighbors of adjacency.values()) neighbors.sort();

  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let nextIndex = 0;

  function visit(node) {
    indexByNode.set(node, nextIndex);
    lowLinkByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indexByNode.has(neighbor)) {
        visit(neighbor);
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), lowLinkByNode.get(neighbor)));
      } else if (onStack.has(neighbor)) {
        lowLinkByNode.set(node, Math.min(lowLinkByNode.get(node), indexByNode.get(neighbor)));
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) return;

    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  }

  for (const node of [...nodes].sort()) {
    if (!indexByNode.has(node)) visit(node);
  }

  function findCyclePath(component) {
    const componentSet = new Set(component);
    const start = [...component].sort()[0];
    const pathStack = [];
    const active = new Set();

    function search(node) {
      pathStack.push(node);
      active.add(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        if (!componentSet.has(neighbor)) continue;
        const activeIndex = pathStack.indexOf(neighbor);
        if (activeIndex >= 0) return [...pathStack.slice(activeIndex), neighbor];
        if (!active.has(neighbor)) {
          const result = search(neighbor);
          if (result) return result;
        }
      }

      pathStack.pop();
      active.delete(node);
      return null;
    }

    return search(start) ?? [...component.sort(), start];
  }

  const cyclicComponents = components.filter((component) => {
    if (component.length > 1) return true;
    return adjacency.get(component[0])?.includes(component[0]);
  });
  const cycles = cyclicComponents
    .map(findCyclePath)
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));

  return { cycles, cyclicComponents };
}

function analyze(projectRoot) {
  const sourceRoot = path.join(projectRoot, "src");
  const sourcePaths = walkFiles(sourceRoot).filter(isSourceFile).sort();
  const modules = [];
  const moduleByPath = new Map();

  for (const filePath of sourcePaths) {
    const projectPath = normalizeProjectPath(projectRoot, filePath);
    const classification = classifyModule(projectPath);
    if (!classification) {
      throw new Error(`No architecture layer matches ${projectPath}.`);
    }

    const module = {
      path: projectPath,
      filePath,
      classification,
      isTest: testFilePatterns.some((pattern) => pattern.test(projectPath)),
    };
    modules.push(module);
    moduleByPath.set(projectPath, module);
  }

  const allEdges = [];
  for (const importer of modules) {
    for (const specifier of readModuleSpecifiers(importer.filePath)) {
      const resolution = resolveLocalModule(importer.filePath, specifier);
      if (resolution.kind === "external" || resolution.kind === "asset") continue;
      if (resolution.kind === "unresolved") continue;

      const importedPath = normalizeProjectPath(projectRoot, resolution.filePath);
      const imported = moduleByPath.get(importedPath);
      if (!imported) continue;
      allEdges.push({ importer: importer.path, imported: imported.path });
    }
  }

  const uniqueEdges = [
    ...new Map(allEdges.map((edge) => [edgeKey(edge.importer, edge.imported), edge])).values(),
  ].sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) || left.imported.localeCompare(right.imported),
  );
  const productionModules = modules.filter((module) => !module.isTest);
  const productionEdges = uniqueEdges.filter((edge) => !moduleByPath.get(edge.importer).isTest);
  const testEdges = uniqueEdges.filter((edge) => moduleByPath.get(edge.importer).isTest);
  const { cycles } = findCycles(
    new Set(productionModules.map((module) => module.path)),
    productionEdges,
  );
  const featureEdges = productionEdges.filter((edge) => {
    const from = moduleByPath.get(edge.importer).classification.featureDomain;
    const to = moduleByPath.get(edge.imported).classification.featureDomain;
    return from && to && from !== to;
  });
  const featureDomainPairs = [
    ...new Map(
      featureEdges.map((edge) => {
        const from = moduleByPath.get(edge.importer).classification.featureDomain;
        const to = moduleByPath.get(edge.imported).classification.featureDomain;
        return [edgeKey(from, to), { importer: from, imported: to }];
      }),
    ).values(),
  ];
  const { cycles: featureCycles, cyclicComponents } = findCycles(
    new Set(productionModules.map((module) => module.classification.featureDomain).filter(Boolean)),
    featureDomainPairs,
  );
  const cyclicComponentByDomain = new Map(
    cyclicComponents.flatMap((component, index) => component.map((domain) => [domain, index])),
  );
  const cyclicDomainPairs = featureDomainPairs.filter(
    (pair) =>
      cyclicComponentByDomain.has(pair.importer) &&
      cyclicComponentByDomain.get(pair.importer) === cyclicComponentByDomain.get(pair.imported),
  );
  const baseline = readFeatureBaseline(projectRoot);
  const featureEdgeKeys = new Set(
    featureEdges.map((edge) => edgeKey(edge.importer, edge.imported)),
  );
  for (const key of baseline.allowedEdges) {
    if (!featureEdgeKeys.has(key)) {
      throw new Error(`Stale feature-domain baseline edge: ${key.replace("\u0000", " -> ")}.`);
    }
  }
  const cyclicPairKeys = new Set(
    cyclicDomainPairs.map((pair) => edgeKey(pair.importer, pair.imported)),
  );
  for (const key of baseline.allowedCyclicPairs) {
    if (!cyclicPairKeys.has(key)) {
      throw new Error(
        `Stale cyclic feature-domain baseline pair: ${key.replace("\u0000", " -> ")}.`,
      );
    }
  }

  const violations = [];
  for (const edge of productionEdges) {
    const importer = moduleByPath.get(edge.importer);
    const imported = moduleByPath.get(edge.imported);
    const violation = evaluateEdge(importer, imported);
    if (!violation) continue;
    violations.push({ ...edge, ...violation });
  }
  for (const edge of featureEdges) {
    if (baseline.allowedEdges.has(edgeKey(edge.importer, edge.imported))) continue;
    violations.push({
      ...edge,
      rule: "unapproved-feature-edge",
      hint: "Review the cross-domain dependency and add the exact edge with a reason to the feature baseline if justified.",
    });
  }
  for (const pair of cyclicDomainPairs) {
    if (baseline.allowedCyclicPairs.has(edgeKey(pair.importer, pair.imported))) continue;
    violations.push({
      importer: `src/features/${pair.importer}`,
      imported: `src/features/${pair.imported}`,
      rule: "new-feature-cycle",
      hint: "Break the new domain cycle or explicitly review its domain pair in the cycle baseline.",
    });
  }

  return {
    modules,
    productionModules,
    productionEdges,
    testEdges,
    featureEdges,
    featureDomainPairs,
    featureCycles,
    cycles,
    violations,
  };
}

function printHumanReport(result) {
  for (const cycle of result.cycles) {
    console.error("\n[architecture] ERROR cycle");
    console.error(`  path: ${cycle.join(" -> ")}`);
    console.error(
      "  hint: Break the cycle through an owning public contract or invert the dependency.",
    );
  }

  for (const violation of result.violations) {
    console.error(`\n[architecture] ERROR ${violation.rule}`);
    console.error(`  importer: ${violation.importer}`);
    console.error(`  imported: ${violation.imported}`);
    console.error(`  hint: ${violation.hint}`);
  }

  const hasErrors = result.cycles.length > 0 || result.violations.length > 0;

  console.log(
    [
      `\nArchitecture ${hasErrors ? "check failed" : "check passed"}:`,
      `${result.productionModules.length} production modules,`,
      `${result.productionEdges.length} production edges,`,
      `${result.testEdges.length} test-only edges,`,
      `${result.featureEdges.length} cross-domain feature edges.`,
    ].join(" "),
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = analyze(options.projectRoot);
  const output = {
    ok: result.cycles.length === 0 && result.violations.length === 0,
    productionModuleCount: result.productionModules.length,
    productionEdgeCount: result.productionEdges.length,
    testOnlyEdgeCount: result.testEdges.length,
    featureDomainEdgeCount: result.featureEdges.length,
    featureDomainPairCount: result.featureDomainPairs.length,
    featureCycles: result.featureCycles,
    cycleCount: result.cycles.length,
    cycles: result.cycles,
    violations: result.violations,
  };

  if (options.json) console.log(JSON.stringify(output));
  else printHumanReport(result);

  if (!output.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[architecture] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
