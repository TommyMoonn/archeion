import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDirectory, "..");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function parseArguments(argv) {
  const options = {
    projectRoot: defaultProjectRoot,
    json: false,
    writeBaseline: false,
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

    if (argument === "--write-baseline") {
      options.writeBaseline = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function normalizeProjectPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

function resolveProjectPath(projectRoot, projectPath) {
  return path.resolve(projectRoot, ...projectPath.split("/"));
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

function compilePatterns(patterns, label) {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(
        `Invalid ${label} pattern '${pattern}': ${error instanceof Error ? error.message : error}`,
      );
    }
  });
}

function validateRules(rules) {
  if (rules.schemaVersion !== 1) {
    throw new Error("frontend-boundaries.json schemaVersion must be 1.");
  }
  if (typeof rules.sourceRoot !== "string") {
    throw new Error("frontend-boundaries.json needs sourceRoot.");
  }
  if (!Array.isArray(rules.testFilePatterns)) {
    throw new Error("frontend-boundaries.json needs testFilePatterns.");
  }
  if (!Array.isArray(rules.layers) || rules.layers.length === 0) {
    throw new Error("frontend-boundaries.json needs at least one layer.");
  }
  if (!Array.isArray(rules.publicModules)) {
    throw new Error("frontend-boundaries.json needs publicModules.");
  }
  if (!Array.isArray(rules.restrictedDirections)) {
    throw new Error("frontend-boundaries.json needs restrictedDirections.");
  }
}

function validateExceptions(exceptions) {
  if (exceptions.schemaVersion !== 1) {
    throw new Error("frontend-boundary-exceptions.json schemaVersion must be 1.");
  }
  if (!Array.isArray(exceptions.exceptions)) {
    throw new Error("frontend-boundary-exceptions.json needs exceptions.");
  }

  const ids = new Set();
  for (const exception of exceptions.exceptions) {
    const requiredStrings = ["id", "importer", "imported", "rule", "reason", "removalCondition"];
    for (const field of requiredStrings) {
      if (typeof exception[field] !== "string" || exception[field].trim().length === 0) {
        throw new Error(`Architecture exception needs a non-empty ${field}.`);
      }
    }
    if (ids.has(exception.id)) {
      throw new Error(`Duplicate architecture exception id: ${exception.id}.`);
    }
    ids.add(exception.id);
    if (
      typeof exception.owner !== "object" ||
      typeof exception.owner?.plan !== "string" ||
      typeof exception.owner?.phase !== "string" ||
      exception.owner.plan.trim().length === 0 ||
      exception.owner.phase.trim().length === 0
    ) {
      throw new Error(`Architecture exception ${exception.id} needs an owning plan and phase.`);
    }
  }
}

function classifyModule(projectPath, rules) {
  for (const layer of rules.layers) {
    const exactFiles = layer.files ?? [];
    if (exactFiles.includes(projectPath)) {
      return { layer: layer.name, feature: null };
    }

    for (const root of layer.roots ?? []) {
      if (projectPath === root || projectPath.startsWith(`${root}/`)) {
        const feature = layer.name === "features" ? (projectPath.split("/")[2] ?? null) : null;
        return { layer: layer.name, feature };
      }
    }
  }

  return null;
}

function moduleDescriptor(classification) {
  if (!classification) return "unclassified";
  if (classification.feature) return `feature:${classification.feature}`;
  return classification.layer;
}

function selectorMatches(selector, classification) {
  if (!classification) return false;
  if (selector === classification.layer) return true;
  if (selector === "feature:*") return classification.layer === "features";
  if (selector.startsWith("feature:")) return selector === moduleDescriptor(classification);
  return false;
}

function isPublicModule(importer, imported, rules) {
  return rules.publicModules.some(
    (entry) =>
      entry.module === imported.path &&
      entry.allowedImporters.some((selector) => selectorMatches(selector, importer.classification)),
  );
}

function findRestrictedDirection(importer, imported, rules) {
  return rules.restrictedDirections.find((direction) => {
    if (direction.from !== importer.classification.layer) return false;
    if (direction.to !== imported.classification.layer) return false;
    if (!direction.crossFeatureOnly) return true;
    return (
      importer.classification.feature !== null &&
      imported.classification.feature !== null &&
      importer.classification.feature !== imported.classification.feature
    );
  });
}

function evaluateEdge(importer, imported, rules) {
  if (imported.isTest) {
    return {
      rule: "production-imports-test",
      hint: [
        "Move the shared contract into production code or keep the dependency inside",
        "the test graph.",
      ].join(" "),
    };
  }

  if (isPublicModule(importer, imported, rules)) return null;

  const importerLayer = rules.layers.find((layer) => layer.name === importer.classification.layer);
  const allowedDependencies = importerLayer?.allowedDependencies ?? [];
  if (!allowedDependencies.includes(imported.classification.layer)) {
    return {
      rule: "forbidden-direction",
      hint:
        `Move the dependency behind a ${imported.classification.layer} public contract ` +
        "or invert the integration at the owning layer.",
    };
  }

  const restrictedDirection = findRestrictedDirection(importer, imported, rules);
  if (restrictedDirection) {
    return {
      rule: restrictedDirection.rule,
      hint: restrictedDirection.hint,
    };
  }

  return null;
}

function edgeKey(importer, imported, rule) {
  return `${importer}\u0000${imported}\u0000${rule}`;
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

function buildBaseline(modules, edges) {
  const fanOut = Object.fromEntries(
    modules
      .map((module) => [
        module.path,
        new Set(edges.filter((edge) => edge.importer === module.path).map((edge) => edge.imported))
          .size,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const lineCounts = Object.fromEntries(
    modules
      .map((module) => [module.path, module.lineCount])
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    schemaVersion: 1,
    generatedBy: "scripts/check-architecture.mjs --write-baseline",
    fanOut,
    lineCounts,
  };
}

function analyze(projectRoot, rules, exceptionsFile) {
  validateRules(rules);
  validateExceptions(exceptionsFile);

  const testPatterns = compilePatterns(rules.testFilePatterns, "test file");
  const sourceRoot = resolveProjectPath(projectRoot, rules.sourceRoot);
  const sourcePaths = walkFiles(sourceRoot).filter(isSourceFile).sort();
  const modules = [];
  const moduleByPath = new Map();
  const unresolvedImports = [];

  for (const filePath of sourcePaths) {
    const projectPath = normalizeProjectPath(projectRoot, filePath);
    const classification = classifyModule(projectPath, rules);
    if (!classification) {
      throw new Error(`No architecture layer matches ${projectPath}.`);
    }

    const sourceText = fs.readFileSync(filePath, "utf8");
    const module = {
      path: projectPath,
      filePath,
      classification,
      isTest: testPatterns.some((pattern) => pattern.test(projectPath)),
      lineCount:
        sourceText.length === 0
          ? 0
          : sourceText.split(/\r?\n/).length - (/\r?\n$/.test(sourceText) ? 1 : 0),
    };
    modules.push(module);
    moduleByPath.set(projectPath, module);
  }

  const allEdges = [];
  for (const importer of modules) {
    for (const specifier of readModuleSpecifiers(importer.filePath)) {
      const resolution = resolveLocalModule(importer.filePath, specifier);
      if (resolution.kind === "external" || resolution.kind === "asset") continue;
      if (resolution.kind === "unresolved") {
        unresolvedImports.push({ importer: importer.path, specifier });
        continue;
      }

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

  const duplicateExceptions = [];
  const exceptionByKey = new Map();
  for (const exception of exceptionsFile.exceptions) {
    const key = edgeKey(exception.importer, exception.imported, exception.rule);
    if (exceptionByKey.has(key)) duplicateExceptions.push(exception);
    exceptionByKey.set(key, exception);
  }

  const usedExceptions = new Set();
  const violations = [];
  for (const edge of productionEdges) {
    const importer = moduleByPath.get(edge.importer);
    const imported = moduleByPath.get(edge.imported);
    const violation = evaluateEdge(importer, imported, rules);
    if (!violation) continue;

    const key = edgeKey(edge.importer, edge.imported, violation.rule);
    const exception = exceptionByKey.get(key);
    if (exception) {
      usedExceptions.add(key);
      continue;
    }

    violations.push({ ...edge, ...violation });
  }

  const staleExceptions = exceptionsFile.exceptions.filter(
    (exception) =>
      !usedExceptions.has(edgeKey(exception.importer, exception.imported, exception.rule)),
  );

  return {
    modules,
    productionModules,
    productionEdges,
    testEdges,
    cycles,
    violations,
    unresolvedImports,
    duplicateExceptions,
    staleExceptions,
    usedExceptionCount: usedExceptions.size,
  };
}

function advisoryReport(analysis, rules, baseline) {
  const options = rules.advisories;
  if (!options) return { fanOut: [], largeFiles: [], growth: [] };

  const outgoing = new Map(analysis.productionModules.map((module) => [module.path, new Set()]));
  for (const edge of analysis.productionEdges) outgoing.get(edge.importer)?.add(edge.imported);

  const fanOut = analysis.productionModules
    .map((module) => ({ path: module.path, count: outgoing.get(module.path)?.size ?? 0 }))
    .filter((entry) => entry.count >= options.fanOutThreshold)
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
    .slice(0, options.reportLimit);
  const largeFiles = analysis.productionModules
    .map((module) => ({ path: module.path, lines: module.lineCount }))
    .filter((entry) => entry.lines >= options.lineCountThreshold)
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
    .slice(0, options.reportLimit);

  const growth = [];
  if (baseline) {
    for (const module of analysis.productionModules) {
      const priorLines = baseline.lineCounts?.[module.path];
      const currentFanOut = outgoing.get(module.path)?.size ?? 0;
      const priorFanOut = baseline.fanOut?.[module.path];

      if (
        typeof priorLines === "number" &&
        module.lineCount - priorLines >= options.lineGrowthNotice
      ) {
        growth.push({
          path: module.path,
          metric: "lines",
          baseline: priorLines,
          current: module.lineCount,
          delta: module.lineCount - priorLines,
        });
      }
      if (
        typeof priorFanOut === "number" &&
        currentFanOut - priorFanOut >= options.fanOutGrowthNotice
      ) {
        growth.push({
          path: module.path,
          metric: "fan-out",
          baseline: priorFanOut,
          current: currentFanOut,
          delta: currentFanOut - priorFanOut,
        });
      }
      if (priorLines === undefined && module.lineCount >= options.lineCountThreshold) {
        growth.push({
          path: module.path,
          metric: "new-large-file",
          baseline: 0,
          current: module.lineCount,
          delta: module.lineCount,
        });
      }
    }
  }

  growth.sort((left, right) => right.delta - left.delta || left.path.localeCompare(right.path));
  return { fanOut, largeFiles, growth };
}

function printHumanReport(result, advisories) {
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

  for (const unresolved of result.unresolvedImports) {
    console.error("\n[architecture] ERROR unresolved-local-import");
    console.error(`  importer: ${unresolved.importer}`);
    console.error(`  specifier: ${unresolved.specifier}`);
    console.error(
      "  hint: Correct the local module path or use an explicit non-code asset extension.",
    );
  }

  for (const exception of result.duplicateExceptions) {
    console.error("\n[architecture] ERROR duplicate-exception");
    console.error(`  importer: ${exception.importer}`);
    console.error(`  imported: ${exception.imported}`);
    console.error(`  rule: ${exception.rule}`);
    console.error("  hint: Keep one owned exception record for the exact edge.");
  }

  for (const exception of result.staleExceptions) {
    console.error("\n[architecture] ERROR stale-exception");
    console.error(`  importer: ${exception.importer}`);
    console.error(`  imported: ${exception.imported}`);
    console.error(`  rule: ${exception.rule}`);
    console.error(
      "  hint: Remove the exception because the exact production edge no longer needs it.",
    );
  }

  const hasErrors =
    result.cycles.length > 0 ||
    result.violations.length > 0 ||
    result.unresolvedImports.length > 0 ||
    result.duplicateExceptions.length > 0 ||
    result.staleExceptions.length > 0;

  console.log(
    [
      `\nArchitecture ${hasErrors ? "check failed" : "check passed"}:`,
      `${result.productionModules.length} production modules,`,
      `${result.productionEdges.length} production edges,`,
      `${result.testEdges.length} test-only edges,`,
      `${result.usedExceptionCount} temporary exceptions.`,
    ].join(" "),
  );

  if (advisories.growth.length > 0) {
    console.log("\nAdvisory growth since baseline:");
    for (const entry of advisories.growth) {
      console.log(
        `  ${entry.path}: ${entry.metric} ${entry.baseline} -> ${entry.current} (+${entry.delta})`,
      );
    }
  }

  if (advisories.fanOut.length > 0) {
    console.log("\nAdvisory high production fan-out:");
    for (const entry of advisories.fanOut) console.log(`  ${entry.path}: ${entry.count} imports`);
  }

  if (advisories.largeFiles.length > 0) {
    console.log("\nAdvisory large production files:");
    for (const entry of advisories.largeFiles) console.log(`  ${entry.path}: ${entry.lines} lines`);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const architectureRoot = path.join(options.projectRoot, ".project", "architecture");
  const rulesPath = path.join(architectureRoot, "frontend-boundaries.json");
  const exceptionsPath = path.join(architectureRoot, "frontend-boundary-exceptions.json");
  const baselinePath = path.join(architectureRoot, "frontend-architecture-baseline.json");
  const rules = readJson(rulesPath);
  const exceptions = readJson(exceptionsPath);
  const result = analyze(options.projectRoot, rules, exceptions);

  if (options.writeBaseline) {
    const hasErrors =
      result.cycles.length > 0 ||
      result.violations.length > 0 ||
      result.unresolvedImports.length > 0 ||
      result.duplicateExceptions.length > 0 ||
      result.staleExceptions.length > 0;
    if (hasErrors) {
      throw new Error("Refusing to update the baseline while architecture errors exist.");
    }
    const serializedBaseline = JSON.stringify(
      buildBaseline(result.productionModules, result.productionEdges),
      null,
      2,
    );
    fs.writeFileSync(baselinePath, `${serializedBaseline}\n`);
  }

  const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : null;
  const advisories = advisoryReport(result, rules, baseline);
  const output = {
    ok:
      result.cycles.length === 0 &&
      result.violations.length === 0 &&
      result.unresolvedImports.length === 0 &&
      result.duplicateExceptions.length === 0 &&
      result.staleExceptions.length === 0,
    productionModuleCount: result.productionModules.length,
    productionEdgeCount: result.productionEdges.length,
    testOnlyEdgeCount: result.testEdges.length,
    cycleCount: result.cycles.length,
    cycles: result.cycles,
    violations: result.violations,
    unresolvedImports: result.unresolvedImports,
    duplicateExceptions: result.duplicateExceptions,
    staleExceptions: result.staleExceptions,
    usedExceptionCount: result.usedExceptionCount,
    advisories,
  };

  if (options.json) console.log(JSON.stringify(output));
  else printHumanReport(result, advisories);

  if (!output.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[architecture] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
