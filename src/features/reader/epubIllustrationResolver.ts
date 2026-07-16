import type { Book as EpubBook } from "epubjs";

import { classifyEpubLink, type EpubLocalTarget } from "./epubContentActions";

export const EPUB_ILLUSTRATION_MAX_BYTES = 32 * 1024 * 1024;
export const EPUB_ILLUSTRATION_MAX_DIMENSION = 8192;
export const EPUB_ILLUSTRATION_MAX_PIXELS = 40_000_000;

const SUPPORTED_MEDIA_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type IllustrationBookAdapter = EpubBook & {
  archive?: { getBlob?: (path: string, mediaType?: string) => Promise<Blob> | undefined };
  packaging: EpubBook["packaging"] & {
    manifest: Record<string, Readonly<{ href: string; type: string }>>;
  };
  resources?: {
    replacementUrls?: unknown;
    urls?: unknown;
  };
};

export type EpubIllustrationDimensions = Readonly<{ height: number; width: number }>;

export type ResolvedEpubIllustration = Readonly<{
  byteLength: number;
  height: number;
  href: string;
  mediaType: string;
  release: () => void;
  url: string;
  width: number;
}>;

export type EpubIllustrationResolution =
  | Readonly<{ kind: "resolved"; value: ResolvedEpubIllustration }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{
      kind: "unsupported";
      reason: "dimensions" | "missing" | "size" | "source" | "type";
    }>;

export type EpubIllustrationResolverDependencies = Readonly<{
  createObjectUrl: (blob: Blob) => string;
  decodeDimensions: (url: string, signal?: AbortSignal) => Promise<EpubIllustrationDimensions>;
  revokeObjectUrl: (url: string) => void;
}>;

export async function resolveEpubIllustration(
  book: EpubBook,
  target: EpubLocalTarget,
  signal?: AbortSignal,
  dependencies: EpubIllustrationResolverDependencies = browserDependencies,
): Promise<EpubIllustrationResolution> {
  if (signal?.aborted) return { kind: "cancelled" };
  if (target.resourceKind !== "illustration" || target.fragment) {
    return { kind: "unsupported", reason: "source" };
  }

  const adaptedBook = book as IllustrationBookAdapter;
  const item = matchingManifestItem(adaptedBook, target.documentHref);
  if (!item) return { kind: "unsupported", reason: "missing" };
  const mediaType = normalizedMediaType(item.type);
  if (!mediaType || !SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return { kind: "unsupported", reason: "type" };
  }

  const resolvedPath = safeResolvedBookPath(adaptedBook, item.href);
  if (!resolvedPath || typeof adaptedBook.archive?.getBlob !== "function") {
    return { kind: "unsupported", reason: "source" };
  }

  let blob: Blob;
  try {
    const loaded = await adaptedBook.archive.getBlob(resolvedPath, mediaType);
    if (!(loaded instanceof Blob)) return { kind: "unsupported", reason: "missing" };
    blob = loaded;
  } catch {
    return signal?.aborted ? { kind: "cancelled" } : { kind: "unsupported", reason: "missing" };
  }
  if (signal?.aborted) return { kind: "cancelled" };
  if (blob.size <= 0 || blob.size > EPUB_ILLUSTRATION_MAX_BYTES) {
    return { kind: "unsupported", reason: "size" };
  }

  let url: string;
  try {
    url = dependencies.createObjectUrl(blob);
  } catch {
    return { kind: "unsupported", reason: "source" };
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    dependencies.revokeObjectUrl(url);
  };

  if (signal?.aborted) {
    release();
    return { kind: "cancelled" };
  }

  try {
    const dimensions = await dependencies.decodeDimensions(url, signal);
    if (signal?.aborted) {
      release();
      return { kind: "cancelled" };
    }
    if (!dimensionsAreSupported(dimensions)) {
      release();
      return { kind: "unsupported", reason: "dimensions" };
    }
    return {
      kind: "resolved",
      value: Object.freeze({
        byteLength: blob.size,
        height: dimensions.height,
        href: target.documentHref,
        mediaType,
        release,
        url,
        width: dimensions.width,
      }),
    };
  } catch {
    release();
    return signal?.aborted ? { kind: "cancelled" } : { kind: "unsupported", reason: "dimensions" };
  }
}

export function illustrationTargetForElement(
  book: EpubBook,
  element: Element,
  currentDocumentHref: string,
): EpubLocalTarget | null {
  const source = illustrationSource(element);
  if (!source) return null;

  const classified = classifyEpubLink({ currentDocumentHref, href: source });
  if (classified.kind === "illustration") return classified.target;
  if (!isGeneratedResourceUrl(source)) return null;

  const original = originalResourceHref(book as IllustrationBookAdapter, source);
  if (!original) return null;
  const normalized = normalizedManifestHref(original);
  if (!normalized) return null;
  return {
    displayTarget: normalized,
    documentHref: normalized,
    resourceKind: "illustration",
  };
}

export function illustrationElementFromTarget(target: Element | null): Element | null {
  const illustration = target?.closest("img, image") ?? null;
  if (illustration) return illustration;
  return target?.localName.toLowerCase() === "svg" ? target.querySelector("image") : null;
}

function illustrationSource(element: Element): string | null {
  const name = element.localName.toLowerCase();
  if (name === "img") {
    const source = element.getAttribute("src");
    return source !== null && !hasControlCharacter(source) ? source.trim() || null : null;
  }
  if (name === "image") {
    const href = element.getAttribute("href");
    const xlinkHref = element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    if (
      (href !== null && hasControlCharacter(href)) ||
      (xlinkHref !== null && hasControlCharacter(xlinkHref))
    ) {
      return null;
    }
    return href?.trim() || xlinkHref?.trim() || null;
  }
  return null;
}

function matchingManifestItem(
  book: IllustrationBookAdapter,
  targetHref: string,
): Readonly<{ href: string; type: string }> | null {
  const target = normalizedManifestHref(targetHref);
  if (!target) return null;
  const matches = Object.values(book.packaging.manifest ?? {}).filter((item) => {
    if (!item || typeof item.href !== "string" || typeof item.type !== "string") return false;
    const manifestPath = normalizedManifestHref(item.href);
    const resolvedPath = safeResolvedBookPath(book, item.href);
    const normalizedResolved = resolvedPath ? normalizedManifestHref(resolvedPath) : null;
    return manifestPath === target || normalizedResolved === target;
  });
  return matches.length === 1 ? matches[0]! : null;
}

function originalResourceHref(book: IllustrationBookAdapter, source: string): string | null {
  const urls = Array.isArray(book.resources?.urls) ? book.resources.urls : [];
  const replacements = Array.isArray(book.resources?.replacementUrls)
    ? book.resources.replacementUrls
    : [];
  const index = replacements.findIndex((candidate) => candidate === source);
  const href = index >= 0 ? urls[index] : undefined;
  return typeof href === "string" ? href : null;
}

function safeResolvedBookPath(book: IllustrationBookAdapter, href: string): string | null {
  if (href.trim().startsWith("/") || href.trim().startsWith("//") || hasParentPathSegment(href)) {
    return null;
  }
  const manifestHref = normalizedManifestHref(href);
  if (!manifestHref) return null;
  try {
    const resolved = book.resolve(manifestHref);
    if (
      typeof resolved !== "string" ||
      /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(resolved) ||
      hasParentPathSegment(resolved)
    ) {
      return null;
    }
    const normalized = normalizedManifestHref(resolved);
    return normalized ? `/${normalized}` : null;
  } catch {
    return null;
  }
}

function normalizedManifestHref(value: string): string | null {
  if (hasControlCharacter(value)) return null;
  const withoutFragment = value.trim().replace(/\\/g, "/").split("#", 1)[0] ?? "";
  if (!withoutFragment || withoutFragment.includes("?") || withoutFragment.startsWith("//")) {
    return null;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(withoutFragment)) return null;
  let decoded: string;
  try {
    decoded = decodeURI(withoutFragment);
  } catch {
    return null;
  }
  const segments: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/") || null;
}

function normalizedMediaType(value: string): string | null {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function isGeneratedResourceUrl(value: string): boolean {
  return /^(blob:|data:)/i.test(value);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasParentPathSegment(value: string): boolean {
  if (/%(?:2f|5c)/i.test(value)) return true;
  try {
    return decodeURI(value)
      .replace(/\\/g, "/")
      .split("/")
      .some((segment) => segment === "..");
  } catch {
    return true;
  }
}

function dimensionsAreSupported(dimensions: EpubIllustrationDimensions): boolean {
  const { height, width } = dimensions;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= EPUB_ILLUSTRATION_MAX_DIMENSION &&
    height <= EPUB_ILLUSTRATION_MAX_DIMENSION &&
    width * height <= EPUB_ILLUSTRATION_MAX_PIXELS
  );
}

const browserDependencies: EpubIllustrationResolverDependencies = {
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  decodeDimensions: (url, signal) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      const abort = () => {
        image.src = "";
        reject(new DOMException("Illustration decoding was cancelled.", "AbortError"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        signal?.removeEventListener("abort", abort);
        resolve({ height: image.naturalHeight, width: image.naturalWidth });
      };
      image.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(new Error("Illustration dimensions could not be decoded."));
      };
      image.decoding = "async";
      image.src = url;
    }),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
};
