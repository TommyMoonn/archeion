import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(root, "tests/fixtures/app-settings-mutations/v2.json");
const typePath = path.join(root, "src/types/appSettings.ts");
const rustPath = path.join(root, "src-tauri/src/commands/app_settings.rs");
const groups = [
  ["areas", "AppSettingsMutation"],
  ["filesAndMetadataFields", "FilesAndMetadataSettingsMutation"],
  ["libraryFields", "LibrarySettingsMutation"],
  ["readerFields", "ReaderSettingsMutation"],
];

function typeScriptVariants(source, name) {
  const declaration = source.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  if (!declaration || !ts.isUnionTypeNode(declaration.type)) {
    throw new Error(`${name} must be a discriminated union.`);
  }
  const discriminator = name === "AppSettingsMutation" ? "area" : "field";
  return declaration.type.types.map((variant) => {
    if (!ts.isTypeLiteralNode(variant)) throw new Error(`${name} has an unsupported variant.`);
    const property = variant.members.find(
      (member) => ts.isPropertySignature(member) && member.name?.getText(source) === discriminator,
    );
    if (
      !property ||
      !ts.isPropertySignature(property) ||
      !property.type ||
      !ts.isLiteralTypeNode(property.type) ||
      !ts.isStringLiteral(property.type.literal)
    ) {
      throw new Error(`${name} has a variant without a literal ${discriminator}.`);
    }
    return property.type.literal.text;
  });
}

function rustVariants(contents, name) {
  const match = new RegExp(`pub enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(contents);
  if (!match) throw new Error(`Missing Rust ${name}.`);
  const variants = [];
  for (const line of match[1]
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const variant = /^([A-Z][A-Za-z0-9]*)\([^)]*\),$/.exec(line);
    if (!variant) throw new Error(`Unsupported Rust ${name} variant: ${line}`);
    variants.push(variant[1][0].toLowerCase() + variant[1].slice(1));
  }
  return variants;
}

function assertExactVocabulary(label, actual, expected) {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    throw new Error(`${label} has duplicate mutation variants.`);
  }
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} differs from the shared corpus: missing [${missing}], extra [${extra}].`,
    );
  }
}

function checkFixtureTypes(corpus) {
  const virtualPath = path.join(
    root,
    "tests/fixtures/app-settings-mutations/__wire_typecheck__.ts",
  );
  const lines = ['import type { AppSettingsMutation } from "../../../src/types/appSettings";'];
  const expectedByLine = new Map();
  for (const fixture of corpus.cases) {
    for (const step of fixture.steps) {
      lines.push(
        `const mutation${lines.length}: AppSettingsMutation = ${JSON.stringify(step.mutation)};`,
      );
      expectedByLine.set(lines.length, { name: fixture.name, valid: true });
    }
  }
  for (const fixture of corpus.invalid) {
    lines.push(
      `const mutation${lines.length}: AppSettingsMutation = ${JSON.stringify(fixture.mutation)};`,
    );
    expectedByLine.set(lines.length, { name: fixture.name, valid: false });
  }
  const contents = `${lines.join("\n")}\n`;
  const options = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const isVirtual = (fileName) => path.normalize(fileName) === path.normalize(virtualPath);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    isVirtual(fileName)
      ? ts.createSourceFile(fileName, contents, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = (
    (fileExists) => (fileName) =>
      isVirtual(fileName) || fileExists(fileName)
  )(host.fileExists.bind(host));
  host.readFile = ((readFile) => (fileName) =>
    isVirtual(fileName) ? contents : readFile(fileName))(host.readFile.bind(host));
  const program = ts.createProgram([virtualPath], options, host);
  const errorsByLine = new Map();
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (
      !diagnostic.file ||
      !isVirtual(diagnostic.file.fileName) ||
      diagnostic.start === undefined
    ) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
    const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
    errorsByLine.set(line, [...(errorsByLine.get(line) ?? []), diagnostic]);
  }
  for (const line of errorsByLine.keys()) {
    if (!expectedByLine.has(line))
      throw new Error(`Unexpected wire typecheck error on line ${line}.`);
  }
  for (const [line, fixture] of expectedByLine) {
    const errors = errorsByLine.get(line) ?? [];
    if (fixture.valid && errors.length) {
      throw new Error(`${fixture.name}: valid serialized mutation does not typecheck.`);
    }
    if (!fixture.valid && !errors.length) {
      throw new Error(`${fixture.name}: invalid serialized mutation typechecks.`);
    }
  }
}

function check() {
  const corpus = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (corpus.version !== 2 || !corpus.cases?.length || !corpus.invalid?.length) {
    throw new Error("Expected a nonempty v2 settings mutation corpus.");
  }
  const source = ts.createSourceFile(
    typePath,
    fs.readFileSync(typePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const rust = fs.readFileSync(rustPath, "utf8");
  for (const [key, name] of groups) {
    const expected = corpus.vocabulary?.[key];
    if (!Array.isArray(expected) || !expected.length) throw new Error(`Missing ${key} vocabulary.`);
    assertExactVocabulary(`TypeScript ${name}`, typeScriptVariants(source, name), expected);
    assertExactVocabulary(`Rust ${name}`, rustVariants(rust, name), expected);
  }
  checkFixtureTypes(corpus);
  console.log(
    `Settings mutation contract: ${corpus.cases.length} valid sequences, ${corpus.invalid.length} invalid wires, 4 exhaustive vocabularies.`,
  );
}

try {
  check();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
