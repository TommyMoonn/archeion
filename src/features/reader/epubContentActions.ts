export type EpubLocalResourceKind = "document" | "illustration";

export type EpubLocalTarget = Readonly<{
  displayTarget: string;
  documentHref: string;
  fragment?: string;
  resourceKind: EpubLocalResourceKind;
}>;

export type EpubTargetSemantics = Readonly<{
  epubTypes: readonly string[];
  role?: string;
}>;

export type EpubContentAction =
  | Readonly<{ kind: "footnote"; target: EpubLocalTarget }>
  | Readonly<{ kind: "internal"; target: EpubLocalTarget }>
  | Readonly<{ kind: "illustration"; target: EpubLocalTarget }>
  | Readonly<{ host: string; kind: "external"; url: string }>
  | Readonly<{ kind: "unsupported"; reason: EpubUnsupportedLinkReason }>;

export type EpubUnsupportedLinkReason =
  "empty" | "malformed" | "remote-content" | "traversal" | "unsafe-scheme" | "unsupported-resource";

export type ClassifyEpubLinkInput = Readonly<{
  currentDocumentHref: string;
  href: string;
  sourceSemantics?: EpubTargetSemantics;
  targetSemantics?: EpubTargetSemantics;
}>;

const DOCUMENT_EXTENSIONS = new Set(["htm", "html", "xht", "xhtml"]);
const ILLUSTRATION_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const FOOTNOTE_EPUB_TYPES = new Set(["endnote", "footnote", "rearnote"]);
const FOOTNOTE_ROLES = new Set(["doc-endnote", "doc-footnote"]);
const NOTEREF_EPUB_TYPES = new Set(["noteref"]);
const NOTEREF_ROLES = new Set(["doc-noteref"]);

export function classifyEpubLink(input: ClassifyEpubLinkInput): EpubContentAction {
  if (hasAsciiControlCharacter(input.href)) {
    return { kind: "unsupported", reason: "malformed" };
  }
  const href = input.href.trim();
  if (!href) return { kind: "unsupported", reason: "empty" };

  const absolute = classifyAbsoluteTarget(href);
  if (absolute) return absolute;

  const local = resolveEpubLocalTarget(input.currentDocumentHref, href);
  if ("kind" in local) return local;

  if (
    isFootnoteReferenceSemantics(input.sourceSemantics) ||
    isFootnoteTargetSemantics(input.targetSemantics)
  ) {
    return { kind: "footnote", target: local };
  }

  return local.resourceKind === "illustration"
    ? { kind: "illustration", target: local }
    : { kind: "internal", target: local };
}

export function resolveEpubLocalTarget(
  currentDocumentHref: string,
  href: string,
): EpubLocalTarget | Readonly<{ kind: "unsupported"; reason: EpubUnsupportedLinkReason }> {
  const rawHref = href.trim().replace(/\\/g, "/");
  if (!rawHref) return { kind: "unsupported", reason: "empty" };
  if (rawHref.startsWith("//")) return { kind: "unsupported", reason: "remote-content" };
  if (rawHref.startsWith("/")) return { kind: "unsupported", reason: "traversal" };

  const hashIndex = rawHref.indexOf("#");
  const beforeFragment = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
  const rawFragment = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : undefined;
  if (beforeFragment.includes("?")) return { kind: "unsupported", reason: "malformed" };

  const decodedDocument = safeDecodeUri(beforeFragment);
  const decodedCurrent = safeDecodeUri(currentDocumentHref.trim().replace(/\\/g, "/"));
  if (decodedDocument === null || decodedCurrent === null) {
    return { kind: "unsupported", reason: "malformed" };
  }

  const currentPath = splitDocumentHref(decodedCurrent);
  if (!currentPath || currentPath.absolute || currentPath.traversedRoot) {
    return { kind: "unsupported", reason: "malformed" };
  }

  const targetPath = decodedDocument
    ? normalizeRelativePath(directoryOf(currentPath.path), decodedDocument)
    : currentPath;
  if (!targetPath || targetPath.absolute) {
    return { kind: "unsupported", reason: "malformed" };
  }
  if (targetPath.traversedRoot) {
    return { kind: "unsupported", reason: "traversal" };
  }
  if (!targetPath.path) {
    return { kind: "unsupported", reason: "malformed" };
  }

  const fragment = rawFragment === undefined ? undefined : safeDecodeComponent(rawFragment);
  if (rawFragment !== undefined && fragment === null) {
    return { kind: "unsupported", reason: "malformed" };
  }

  const extension = extensionOf(targetPath.path);
  const resourceKind = DOCUMENT_EXTENSIONS.has(extension)
    ? "document"
    : ILLUSTRATION_EXTENSIONS.has(extension)
      ? "illustration"
      : undefined;
  if (!resourceKind) {
    return { kind: "unsupported", reason: "unsupported-resource" };
  }
  if (resourceKind === "illustration" && fragment !== undefined) {
    return { kind: "unsupported", reason: "unsupported-resource" };
  }

  return {
    displayTarget: fragment === undefined ? targetPath.path : `${targetPath.path}#${rawFragment}`,
    documentHref: targetPath.path,
    fragment: fragment ?? undefined,
    resourceKind,
  };
}

export function epubSemanticsFromElement(element: Element | null): EpubTargetSemantics {
  if (!element) return { epubTypes: [] };
  const rawTypes =
    element.getAttribute("epub:type") ??
    element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
    "";
  return {
    epubTypes: semanticTokens(rawTypes),
    role: normalizedToken(element.getAttribute("role")),
  };
}

export function targetSemanticsForElement(element: Element | null): EpubTargetSemantics {
  const epubTypes: string[] = [];
  let role: string | undefined;
  let current: Element | null = element;

  while (current && current.tagName.toLowerCase() !== "body") {
    const semantics = epubSemanticsFromElement(current);
    for (const type of semantics.epubTypes) {
      if (!epubTypes.includes(type)) epubTypes.push(type);
    }
    role ??= semantics.role;
    current = current.parentElement;
  }

  return { epubTypes, role };
}

export function isFootnoteReferenceSemantics(semantics: EpubTargetSemantics | undefined): boolean {
  return Boolean(
    semantics &&
    (semantics.epubTypes.some((type) => NOTEREF_EPUB_TYPES.has(type)) ||
      (semantics.role ? NOTEREF_ROLES.has(semantics.role) : false)),
  );
}

export function isFootnoteTargetSemantics(semantics: EpubTargetSemantics | undefined): boolean {
  return Boolean(
    semantics &&
    (semantics.epubTypes.some((type) => FOOTNOTE_EPUB_TYPES.has(type)) ||
      (semantics.role ? FOOTNOTE_ROLES.has(semantics.role) : false)),
  );
}

export function findEpubFragmentTarget(document: Document, fragment: string): Element | null {
  const candidates = uniqueStrings([fragment, safeDecodeComponent(fragment) ?? undefined]);
  for (const candidate of candidates) {
    const byId = document.getElementById(candidate);
    if (byId) return byId;
  }
  for (const candidate of candidates) {
    for (const element of document.querySelectorAll("[name]")) {
      if (element.getAttribute("name") === candidate) return element;
    }
  }
  return null;
}

export function normalizedEpubDocumentHref(value: string): string | null {
  const decoded = safeDecodeUri(value.trim().replace(/\\/g, "/"));
  if (decoded === null) return null;
  const normalized = splitDocumentHref(decoded);
  return normalized && !normalized.absolute && !normalized.traversedRoot ? normalized.path : null;
}

function classifyAbsoluteTarget(href: string): EpubContentAction | null {
  const schemeMatch = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(href);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1]?.toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return { kind: "unsupported", reason: "unsafe-scheme" };
  }
  if (!hasExplicitNetworkAuthority(href)) {
    return { kind: "unsupported", reason: "malformed" };
  }

  try {
    const url = new URL(href);
    if (!url.hostname || url.username || url.password) {
      return { kind: "unsupported", reason: "malformed" };
    }
    return { host: url.host, kind: "external", url: url.toString() };
  } catch {
    return { kind: "unsupported", reason: "malformed" };
  }
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasExplicitNetworkAuthority(href: string): boolean {
  const schemeEnd = href.indexOf(":");
  if (schemeEnd < 0 || href.slice(schemeEnd, schemeEnd + 3) !== "://") return false;

  const authorityAndPath = href.slice(schemeEnd + 3);
  const authorityEnd = authorityAndPath.search(/[/?#]/);
  const authority = authorityAndPath.slice(
    0,
    authorityEnd < 0 ? authorityAndPath.length : authorityEnd,
  );

  return authority.length > 0 && !authority.includes("\\");
}

type NormalizedPath = Readonly<{
  absolute: boolean;
  path: string;
  traversedRoot: boolean;
}>;

function normalizeRelativePath(baseDirectory: string, target: string): NormalizedPath | null {
  const decoded = target.trim().replace(/\\/g, "/");
  if (!decoded) return splitDocumentHref(baseDirectory);
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(decoded)) return null;
  return splitDocumentHref(`${baseDirectory}${decoded}`);
}

function splitDocumentHref(value: string): NormalizedPath | null {
  const path = value.split("#", 1)[0]?.split("?", 1)[0]?.trim().replace(/\\/g, "/") ?? "";
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  let traversedRoot = false;

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) traversedRoot = true;
      else segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return { absolute, path: segments.join("/"), traversedRoot };
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function extensionOf(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot < 0 ? "" : file.slice(dot + 1).toLowerCase();
}

function semanticTokens(value: string): string[] {
  return uniqueStrings(
    value
      .split(/\s+/)
      .map(normalizedToken)
      .filter((token): token is string => Boolean(token)),
  );
}

function normalizedToken(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function safeDecodeUri(value: string): string | null {
  try {
    return decodeURI(value);
  } catch {
    return null;
  }
}

function safeDecodeComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}
