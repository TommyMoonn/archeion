import type {
  ThemeDiagnostic,
  ThemeDiagnosticCode,
  ThemeManifestV1,
  ThemeManifestValidationResult,
} from "./domain";
import {
  appThemeBases,
  appThemePublicTokenRegistry,
  ARCHEION_THEME_SCHEMA_URL,
  ARCHEION_THEME_SCHEMA_VERSION,
  readerThemeBases,
  readerThemePublicTokenRegistry,
  type AppThemeOverrides,
  type ReaderThemeBase,
  type ReaderThemeOverrides,
  type ThemeColor,
} from "./themeTokenRegistry";
import { isThemeColor, normalizeThemeColor } from "./themeColor";

const ROOT_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "id",
  "name",
  "author",
  "description",
  "base",
  "app",
  "reader",
]);
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export type ThemeManifestValidationOptions = Readonly<{ expectedId?: string }>;

export function validateThemeManifest(
  value: unknown,
  options: ThemeManifestValidationOptions = {},
): ThemeManifestValidationResult {
  const diagnostics: ThemeDiagnostic[] = [];
  if (!isRecord(value)) {
    return failure([diagnostic("invalid-type", "$", "Theme manifest must be a JSON object.")]);
  }

  reportUnknownProperties(value, ROOT_KEYS, "$", diagnostics);

  const schema = optionalCanonicalSchema(value.$schema, diagnostics);
  const schemaVersion = requiredSchemaVersion(value, diagnostics);
  const id = requiredThemeId(value, options.expectedId, diagnostics);
  const name = requiredMetadata(value, "name", 80, diagnostics);
  const author = optionalMetadata(value.author, "author", 80, diagnostics);
  const description = optionalMetadata(value.description, "description", 240, diagnostics);
  const base = requiredEnum(value, "base", appThemeBases, "$", diagnostics);
  const app = requiredColorOverrides(value, "app", appThemePublicTokenRegistry, diagnostics);
  const reader = optionalReaderOverrides(value.reader, diagnostics);

  if (diagnostics.length > 0) return failure(diagnostics);
  if (
    schemaVersion !== ARCHEION_THEME_SCHEMA_VERSION ||
    id === undefined ||
    name === undefined ||
    base === undefined ||
    app === undefined
  ) {
    throw new Error("Theme validation succeeded without all required normalized fields.");
  }

  const manifest: ThemeManifestV1 = Object.freeze({
    ...(schema ? { $schema: schema } : {}),
    schemaVersion,
    id,
    name,
    ...(author === undefined ? {} : { author }),
    ...(description === undefined ? {} : { description }),
    base,
    app: Object.freeze(app),
    ...(reader === undefined ? {} : { reader: Object.freeze(reader) }),
  });
  return Object.freeze({ manifest, ok: true });
}

function optionalCanonicalSchema(
  value: unknown,
  diagnostics: ThemeDiagnostic[],
): typeof ARCHEION_THEME_SCHEMA_URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("invalid-type", "$.$schema", "$schema must be a string."));
    return undefined;
  }
  if (value !== ARCHEION_THEME_SCHEMA_URL) {
    diagnostics.push(
      diagnostic("invalid-value", "$.$schema", `$schema must equal ${ARCHEION_THEME_SCHEMA_URL}.`),
    );
    return undefined;
  }
  return value;
}

function requiredSchemaVersion(
  value: Readonly<Record<string, unknown>>,
  diagnostics: ThemeDiagnostic[],
): typeof ARCHEION_THEME_SCHEMA_VERSION | undefined {
  if (!Object.hasOwn(value, "schemaVersion")) {
    diagnostics.push(
      diagnostic("missing-property", "$.schemaVersion", "schemaVersion is required."),
    );
    return undefined;
  }
  if (typeof value.schemaVersion !== "number" || !Number.isInteger(value.schemaVersion)) {
    diagnostics.push(
      diagnostic("invalid-type", "$.schemaVersion", "schemaVersion must be an integer."),
    );
    return undefined;
  }
  if (value.schemaVersion !== ARCHEION_THEME_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        "unsupported-schema-version",
        "$.schemaVersion",
        `Unsupported theme schema version ${value.schemaVersion}.`,
      ),
    );
    return undefined;
  }
  return value.schemaVersion;
}

function requiredThemeId(
  value: Readonly<Record<string, unknown>>,
  expectedId: string | undefined,
  diagnostics: ThemeDiagnostic[],
): string | undefined {
  const id = requiredString(value, "id", diagnostics);
  if (id === undefined) return undefined;
  const length = unicodeLength(id);
  if (length < 3 || length > 64 || !THEME_ID_PATTERN.test(id)) {
    diagnostics.push(
      diagnostic(
        "invalid-value",
        "$.id",
        "id must be 3 to 64 lowercase ASCII letters, digits, dots, underscores, or hyphens and start with a letter or digit.",
      ),
    );
    return undefined;
  }
  if (expectedId !== undefined && id !== expectedId) {
    diagnostics.push(
      diagnostic(
        "id-mismatch",
        "$.id",
        `Theme id "${id}" must match package directory "${expectedId}".`,
      ),
    );
    return undefined;
  }
  return id;
}

function requiredMetadata(
  value: Readonly<Record<string, unknown>>,
  field: "name",
  maximumLength: number,
  diagnostics: ThemeDiagnostic[],
): string | undefined {
  const metadata = requiredString(value, field, diagnostics);
  return metadata === undefined
    ? undefined
    : validateMetadata(metadata, field, maximumLength, diagnostics);
}

function optionalMetadata(
  value: unknown,
  field: "author" | "description",
  maximumLength: number,
  diagnostics: ThemeDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("invalid-type", `$.${field}`, `${field} must be a string.`));
    return undefined;
  }
  return validateMetadata(value, field, maximumLength, diagnostics);
}

function validateMetadata(
  value: string,
  field: "author" | "description" | "name",
  maximumLength: number,
  diagnostics: ThemeDiagnostic[],
): string | undefined {
  const length = unicodeLength(value);
  if (length < 1 || length > maximumLength || !isValidMetadata(value)) {
    diagnostics.push(
      diagnostic(
        "invalid-value",
        `$.${field}`,
        `${field} must be 1 to ${maximumLength} control-free Unicode characters with at least one non-whitespace character.`,
      ),
    );
    return undefined;
  }
  return value;
}

function requiredString(
  value: Readonly<Record<string, unknown>>,
  field: "id" | "name",
  diagnostics: ThemeDiagnostic[],
): string | undefined {
  if (!Object.hasOwn(value, field)) {
    diagnostics.push(diagnostic("missing-property", `$.${field}`, `${field} is required.`));
    return undefined;
  }
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    diagnostics.push(diagnostic("invalid-type", `$.${field}`, `${field} must be a string.`));
    return undefined;
  }
  return fieldValue;
}

function requiredEnum<const Values extends readonly string[]>(
  value: Readonly<Record<string, unknown>>,
  field: "base",
  values: Values,
  parentPath: "$" | "$.reader",
  diagnostics: ThemeDiagnostic[],
): Values[number] | undefined {
  const path = `${parentPath}.${field}`;
  if (!Object.hasOwn(value, field)) {
    diagnostics.push(diagnostic("missing-property", path, `${field} is required.`));
    return undefined;
  }
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    diagnostics.push(diagnostic("invalid-type", path, `${field} must be a string.`));
    return undefined;
  }
  if (!values.includes(fieldValue)) {
    diagnostics.push(
      diagnostic("invalid-value", path, `${field} must be one of: ${values.join(", ")}.`),
    );
    return undefined;
  }
  return fieldValue;
}

function requiredColorOverrides(
  value: Readonly<Record<string, unknown>>,
  field: "app",
  registry: typeof appThemePublicTokenRegistry,
  diagnostics: ThemeDiagnostic[],
): AppThemeOverrides | undefined {
  if (!Object.hasOwn(value, field)) {
    diagnostics.push(diagnostic("missing-property", `$.${field}`, `${field} is required.`));
    return undefined;
  }
  if (!isRecord(value[field])) {
    diagnostics.push(diagnostic("invalid-type", `$.${field}`, `${field} must be an object.`));
    return undefined;
  }
  return colorOverrides(value[field], field, registry, diagnostics);
}

function optionalReaderOverrides(
  value: unknown,
  diagnostics: ThemeDiagnostic[],
): Readonly<{ base: ReaderThemeBase } & ReaderThemeOverrides> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-type", "$.reader", "reader must be an object."));
    return undefined;
  }

  const base = requiredEnum(value, "base", readerThemeBases, "$.reader", diagnostics);
  const overrides = colorOverrides(value, "reader", readerThemePublicTokenRegistry, diagnostics, [
    "base",
  ]);
  if (base === undefined || overrides === undefined) return undefined;
  return { base, ...overrides };
}

function colorOverrides<Registry extends Readonly<Record<string, unknown>>>(
  value: Readonly<Record<string, unknown>>,
  field: "app" | "reader",
  registry: Registry,
  diagnostics: ThemeDiagnostic[],
  ignoredKeys: readonly string[] = [],
): Partial<Record<keyof Registry, ThemeColor>> | undefined {
  const allowedKeys = new Set([...Object.keys(registry), ...ignoredKeys]);
  reportUnknownProperties(value, allowedKeys, `$.${field}`, diagnostics);
  const overrides: Partial<Record<keyof Registry, ThemeColor>> = {};
  let overrideCount = 0;
  for (const token of objectKeys(registry)) {
    if (!Object.hasOwn(value, token)) continue;
    overrideCount += 1;
    const color = value[token];
    if (!isThemeColor(color)) {
      diagnostics.push(
        diagnostic(
          "invalid-color",
          `$.${field}.${String(token)}`,
          `${String(token)} must use #RRGGBB or #RRGGBBAA.`,
        ),
      );
      continue;
    }
    overrides[token] = normalizeThemeColor(color);
  }
  if (overrideCount === 0) {
    diagnostics.push(
      diagnostic(
        "invalid-value",
        `$.${field}`,
        `${field} must contain at least one supported color override.`,
      ),
    );
  }
  return overrides;
}

function reportUnknownProperties(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  diagnostics: ThemeDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push(
        diagnostic("unknown-property", `${path}.${key}`, `Unknown theme property "${key}".`),
      );
    }
  }
}

function failure(diagnostics: ThemeDiagnostic[]): ThemeManifestValidationResult {
  return Object.freeze({ diagnostics: Object.freeze(diagnostics), ok: false });
}

function diagnostic(code: ThemeDiagnosticCode, path: string, message: string): ThemeDiagnostic {
  return Object.freeze({ code, message, path });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function objectKeys<ObjectType extends Record<string, unknown>>(
  value: ObjectType,
): Array<Extract<keyof ObjectType, string>> {
  return Object.keys(value) as Array<Extract<keyof ObjectType, string>>;
}

function unicodeLength(value: string): number {
  return [...value].length;
}

function isValidMetadata(value: string): boolean {
  if (!/\S/u.test(value)) return false;
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      codePoint > 0x1f &&
      (codePoint < 0x7f || codePoint > 0x9f) &&
      codePoint !== 0x2028 &&
      codePoint !== 0x2029
    );
  });
}
