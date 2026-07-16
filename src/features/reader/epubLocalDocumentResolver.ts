import type { Book as EpubBook } from "epubjs";

import {
  findEpubFragmentTarget,
  normalizedEpubDocumentHref,
  type EpubLocalTarget,
} from "./epubContentActions";

export type EpubResolvedLocalDocument = Readonly<{
  document: Document;
  element: Element | null;
  release: () => void;
}>;

export type EpubLocalDocumentResolution =
  | Readonly<{ kind: "resolved"; value: EpubResolvedLocalDocument }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "unsupported" }>;

type EpubRequest = (...args: unknown[]) => Promise<unknown>;

type EpubSectionAdapter = {
  document?: Document;
  href?: unknown;
  load?: (request?: EpubRequest) => Promise<unknown> | unknown;
  unload?: () => void;
};

type EpubSpineAdapter = {
  each?: (callback: (section: unknown) => void) => void;
  get?: (target?: string | number) => unknown;
};

type EpubLocalDocumentBook = EpubBook & {
  load?: (...args: unknown[]) => Promise<unknown>;
  spine: EpubSpineAdapter;
};

export async function resolveEpubLocalDocument(
  book: EpubBook,
  target: EpubLocalTarget,
  current: Readonly<{ document: Document; href: string }> | null,
  signal?: AbortSignal,
): Promise<EpubLocalDocumentResolution> {
  if (signal?.aborted) return { kind: "cancelled" };
  if (target.resourceKind !== "document") return { kind: "unsupported" };

  const currentHref = current ? normalizedEpubDocumentHref(current.href) : null;
  if (current && currentHref === target.documentHref) {
    return resolvedDocument(current.document, target);
  }

  const adaptedBook = book as EpubLocalDocumentBook;
  const section = findSection(adaptedBook.spine, target.documentHref);
  if (!section) return { kind: "unsupported" };

  if (section.document) {
    return resolvedDocument(section.document, target);
  }

  if (typeof section.load !== "function") return { kind: "unsupported" };
  let loadedByResolver = false;

  try {
    const request =
      typeof adaptedBook.load === "function"
        ? (adaptedBook.load.bind(adaptedBook) as EpubRequest)
        : undefined;
    const loaded = await section.load(request);
    loadedByResolver = Boolean(section.document);
    const document = section.document ?? asDocument(loaded);

    if (signal?.aborted) {
      if (loadedByResolver) safelyUnload(section);
      return { kind: "cancelled" };
    }
    if (!document) {
      if (loadedByResolver) safelyUnload(section);
      return { kind: "unsupported" };
    }

    const resolved = resolvedDocument(document, target, () => {
      if (loadedByResolver) safelyUnload(section);
    });
    return resolved;
  } catch {
    if (loadedByResolver || section.document) safelyUnload(section);
    return signal?.aborted ? { kind: "cancelled" } : { kind: "unsupported" };
  }
}

function resolvedDocument(
  document: Document,
  target: EpubLocalTarget,
  release: () => void = () => undefined,
): EpubLocalDocumentResolution {
  return {
    kind: "resolved",
    value: {
      document,
      element: target.fragment ? findEpubFragmentTarget(document, target.fragment) : null,
      release,
    },
  };
}

function findSection(spine: EpubSpineAdapter, targetHref: string): EpubSectionAdapter | undefined {
  try {
    const direct = asSection(spine.get?.(targetHref));
    if (direct) return direct;
  } catch {
    // Fall through to identity matching for EPUBs whose spine lookup is strict.
  }

  let match: EpubSectionAdapter | undefined;
  try {
    spine.each?.((candidate) => {
      if (match) return;
      const section = asSection(candidate);
      const href =
        typeof section?.href === "string" ? normalizedEpubDocumentHref(section.href) : null;
      if (href === targetHref) match = section;
    });
  } catch {
    return undefined;
  }
  return match;
}

function asSection(value: unknown): EpubSectionAdapter | undefined {
  return typeof value === "object" && value !== null ? (value as EpubSectionAdapter) : undefined;
}

function asDocument(value: unknown): Document | undefined {
  return typeof value === "object" && value !== null && "documentElement" in value
    ? (value as Document)
    : undefined;
}

function safelyUnload(section: EpubSectionAdapter): void {
  try {
    section.unload?.();
  } catch {
    // Resource cleanup should not replace the original resolution outcome.
  }
}
