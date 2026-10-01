import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const testFile = /(?:^|\/)test\/|\.(?:test|spec|testUtils)\.[cm]?[jt]sx?$/;

// These registrations have no supported frontend caller and are retired in C.6.
// An exception must fail when its registration disappears so it cannot linger.
export const backendOnlyCommands = new Set(["load_app_settings", "save_app_settings"]);

// These are typed forwarding boundaries. Their command vocabulary is obtained
// from the adjacent command map, a typed union, or their literal call sites.
const dynamicInvocations = new Map([
  ["src/features/reader/readerIllustrationExportFile.ts", { argument: "command", count: 1 }],
  ["src/features/settings/settingsArchiveMaintenanceClient.ts", { argument: "name", count: 1 }],
  ["src/storage/tauri/archiveCommandClient.ts", { argument: "command", count: 3 }],
  ["src/stores/archiveStore.ts", { argument: "command", count: 1 }],
  ["src/themes/ThemeRepository.ts", { argument: "command", count: 1 }],
]);

const commandMaps = new Map([
  ["src/storage/tauri/archiveCommandClient.ts", "ArchiveCommandMap"],
  ["src/themes/ThemeRepository.ts", "ThemeCommandMap"],
]);

function sourceFile(fileName, contents) {
  const source = ts.createSourceFile(fileName, contents, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) {
    throw new Error(`Cannot parse ${fileName}: ${source.parseDiagnostics[0].messageText}`);
  }
  return source;
}

function stringLiteral(node, context) {
  if (!node || !ts.isStringLiteral(node)) throw new Error(`${context} must be a string literal.`);
  return node.text;
}

function addCommand(commands, name, origin) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid command name ${JSON.stringify(name)} in ${origin}.`);
  }
  commands.add(name);
}

function typeLiteral(node) {
  if (ts.isTypeLiteralNode(node)) return node;
  if (ts.isTypeReferenceNode(node) && node.typeName.getText() === "Readonly") {
    return typeLiteral(node.typeArguments?.[0]);
  }
  throw new Error("Command map must be a type literal or Readonly<type literal>.");
}

function extractMap(source, aliasName, commands) {
  const aliases = source.statements.filter(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName,
  );
  if (aliases.length !== 1) throw new Error(`${source.fileName}: expected one ${aliasName}.`);
  const members = typeLiteral(aliases[0].type).members;
  if (!members.length) throw new Error(`${source.fileName}: ${aliasName} is empty.`);
  const names = new Set();
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) {
      throw new Error(`${source.fileName}: ${aliasName} must have named property signatures.`);
    }
    if (names.has(member.name.text))
      throw new Error(`Duplicate ${aliasName} key ${member.name.text}.`);
    names.add(member.name.text);
    addCommand(commands, member.name.text, aliasName);
  }
}

function extractArchiveRegistryUnion(source, commands) {
  const archiveStore = source.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === "ArchiveStore",
  );
  const method = archiveStore?.members.find(
    (member) =>
      ts.isMethodDeclaration(member) && member.name?.getText(source) === "commitRegistryChange",
  );
  const type = method?.parameters[1]?.type;
  if (!type || !ts.isUnionTypeNode(type)) {
    throw new Error(`${source.fileName}: commitRegistryChange needs a literal command union.`);
  }
  for (const member of type.types) {
    if (!ts.isLiteralTypeNode(member)) {
      throw new Error(`${source.fileName}: registry command union must contain only literals.`);
    }
    addCommand(commands, stringLiteral(member.literal, "Registry command"), source.fileName);
  }
}

export function extractFrontendCommands(files) {
  const commands = new Set();
  const seenDynamic = new Map();
  const seenMaps = new Set();
  let sawRegistryUnion = false;

  for (const [fileName, contents] of Object.entries(files)) {
    const source = sourceFile(fileName, contents);
    const invokeBindings = new Set();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.moduleSpecifier.text !== "@tauri-apps/api/core"
      ) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if ((binding.propertyName ?? binding.name).text === "invoke") {
            invokeBindings.add(binding.name.text);
          }
        }
      }
    }
    const mapName = commandMaps.get(fileName);
    if (mapName) {
      extractMap(source, mapName, commands);
      seenMaps.add(fileName);
    }
    if (fileName === "src/stores/archiveStore.ts") {
      extractArchiveRegistryUnion(source, commands);
      sawRegistryUnion = true;
    }

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const isInvoke =
          (ts.isIdentifier(callee) && invokeBindings.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) && callee.name.text === "invoke");
        if (isInvoke) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) {
            addCommand(commands, argument.text, fileName);
          } else {
            const route = dynamicInvocations.get(fileName);
            if (
              !route ||
              !argument ||
              !ts.isIdentifier(argument) ||
              argument.text !== route.argument
            ) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              throw new Error(`Unclassified dynamic invoke at ${fileName}:${line}.`);
            }
            seenDynamic.set(fileName, (seenDynamic.get(fileName) ?? 0) + 1);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  for (const fileName of commandMaps.keys()) {
    if (!seenMaps.has(fileName)) throw new Error(`Missing typed command map in ${fileName}.`);
  }
  if (!sawRegistryUnion) throw new Error("Missing archive registry command union.");
  for (const [fileName, route] of dynamicInvocations) {
    if (seenDynamic.get(fileName) !== route.count) {
      throw new Error(
        `${fileName}: expected ${route.count} classified dynamic invoke calls, found ${seenDynamic.get(fileName) ?? 0}.`,
      );
    }
  }
  return commands;
}

export function extractRegisteredCommands(rustSource) {
  const macros = [...rustSource.matchAll(/tauri::generate_handler!\s*\[([\s\S]*?)\]/g)];
  if (macros.length !== 1) throw new Error("Expected exactly one tauri::generate_handler! macro.");
  const commands = new Set();
  for (const entry of macros[0][1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const match = /^commands(?:::[a-z][a-z0-9_]*)+::([a-z][a-z0-9_]*)$/.exec(entry);
    if (!match) throw new Error(`Unrecognized Tauri registration: ${entry}.`);
    if (commands.has(match[1])) throw new Error(`Duplicate Tauri registration: ${match[1]}.`);
    commands.add(match[1]);
  }
  return commands;
}

export function compareCommands(frontend, registered, exceptions = backendOnlyCommands) {
  const errors = [];
  for (const name of [...frontend].sort()) {
    if (!registered.has(name)) errors.push(`Frontend command is not registered: ${name}`);
    if (exceptions.has(name))
      errors.push(`Backend-only exception now has a frontend caller: ${name}`);
  }
  for (const name of [...registered].sort()) {
    if (!frontend.has(name) && !exceptions.has(name)) {
      errors.push(`Registration has no frontend command: ${name}`);
    }
  }
  for (const name of [...exceptions].sort()) {
    if (!registered.has(name)) errors.push(`Stale backend-only exception: ${name}`);
  }
  return errors;
}

export function readProductionFiles(root) {
  const files = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
        if (!testFile.test(relative)) files[relative] = fs.readFileSync(absolute, "utf8");
      }
    }
  }
  walk(path.join(root, "src"));
  return files;
}

export function checkProject(root = projectRoot) {
  const frontend = extractFrontendCommands(readProductionFiles(root));
  const rust = fs.readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
  const registered = extractRegisteredCommands(rust);
  const errors = compareCommands(frontend, registered);
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    frontend: frontend.size,
    registered: registered.size,
    backendOnly: backendOnlyCommands.size,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkProject();
    console.log(
      `Tauri command parity: ${result.frontend} frontend, ${result.registered} registered, ${result.backendOnly} scheduled legacy exceptions.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
