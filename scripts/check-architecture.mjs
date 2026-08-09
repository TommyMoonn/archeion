import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

function tokenizeModuleSyntax(sourceText) {
  const tokens = [];
  let index = 0;

  function isIdentifierStart(character) {
    return /[A-Za-z_$]/.test(character);
  }

  function isIdentifierPart(character) {
    return /[A-Za-z0-9_$-]/.test(character);
  }

  function readQuotedString(quote) {
    index += 1;
    let value = "";

    while (index < sourceText.length) {
      const character = sourceText[index];
      if (character === "\\") {
        const next = sourceText[index + 1];
        if (next !== undefined) {
          value += next;
          index += 2;
          continue;
        }
      }
      if (character === quote) {
        index += 1;
        return value;
      }
      value += character;
      index += 1;
    }

    return value;
  }

  function skipTemplateLiteral() {
    index += 1;
    while (index < sourceText.length) {
      const character = sourceText[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "`") {
        index += 1;
        return;
      }
      index += 1;
    }
  }

  while (index < sourceText.length) {
    const character = sourceText[index];
    const next = sourceText[index + 1];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < sourceText.length && sourceText[index] !== "\n") index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < sourceText.length &&
        !(sourceText[index] === "*" && sourceText[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (character === '"' || character === "'") {
      tokens.push({ type: "string", value: readQuotedString(character) });
      continue;
    }

    if (character === "`") {
      skipTemplateLiteral();
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < sourceText.length && isIdentifierPart(sourceText[index])) index += 1;
      tokens.push({ type: "identifier", value: sourceText.slice(start, index) });
      continue;
    }

    tokens.push({ type: "punctuation", value: character });
    index += 1;
  }

  return tokens;
}

function readModuleSpecifiers(filePath) {
  const tokens = tokenizeModuleSyntax(fs.readFileSync(filePath, "utf8"));
  const specifiers = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "import") {
      if (tokens[index + 1]?.value === ".") continue;

      if (tokens[index + 1]?.value === "(") {
        if (tokens[index + 2]?.type === "string") specifiers.push(tokens[index + 2].value);
        continue;
      }

      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate.value === ";") break;
        if (candidate.type === "string") {
          specifiers.push(candidate.value);
          break;
        }
      }
      continue;
    }

    if (token.value === "export") {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const candidate = tokens[cursor];
        if (candidate.value === ";") break;
        if (
          candidate.type === "identifier" &&
          candidate.value === "from" &&
          tokens[cursor + 1]?.type === "string"
        ) {
          specifiers.push(tokens[cursor + 1].value);
          break;
        }
      }
      continue;
    }

    if (
      token.value === "require" &&
      tokens[index + 1]?.value === "(" &&
      tokens[index + 2]?.type === "string"
    ) {
      specifiers.push(tokens[index + 2].value);
    }
  }

  return [...new Set(specifiers)];
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
      return { layer: layer.name, feature: null };
    }

    for (const root of layer.roots ?? []) {
      if (projectPath === root || projectPath.startsWith(`${root}/`)) {
        return { layer: layer.name };
      }
    }
  }

  return null;
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

  return components
    .filter((component) => {
      if (component.length > 1) return true;
      return adjacency.get(component[0])?.includes(component[0]);
    })
    .map(findCyclePath)
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
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
    ...new Map(allEdges.map((edge) => [`${edge.importer}\u0000${edge.imported}`, edge])).values(),
  ].sort(
    (left, right) =>
      left.importer.localeCompare(right.importer) || left.imported.localeCompare(right.imported),
  );
  const productionModules = modules.filter((module) => !module.isTest);
  const productionEdges = uniqueEdges.filter((edge) => !moduleByPath.get(edge.importer).isTest);
  const testEdges = uniqueEdges.filter((edge) => moduleByPath.get(edge.importer).isTest);
  const cycles = findCycles(
    new Set(productionModules.map((module) => module.path)),
    productionEdges,
  );

  const violations = [];
  for (const edge of productionEdges) {
    const importer = moduleByPath.get(edge.importer);
    const imported = moduleByPath.get(edge.imported);
    const violation = evaluateEdge(importer, imported);
    if (!violation) continue;
    violations.push({ ...edge, ...violation });
  }

  return {
    modules,
    productionModules,
    productionEdges,
    testEdges,
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
      `${result.testEdges.length} test-only edges.`,
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
