import type { Book as EpubBook } from "epubjs";

import type { ReaderNavigationPosition } from "../../types/reader";

export type ReaderNavigationDocumentTarget = {
  canonicalDocumentHref: string;
  canonicalFullHref: string;
};

export type ReaderNavigationTarget = ReaderNavigationDocumentTarget & {
  displayTarget: string;
  position: ReaderNavigationPosition;
};

export type ReaderNavigationAdapter = {
  compareCfis: (first: string, second: string) => number | undefined;
  resolveCfiPosition: (cfi: string) => ReaderNavigationPosition | undefined;
  resolveLocationTarget: (href: string) => ReaderNavigationDocumentTarget;
  resolveTargets: (hrefs: readonly string[]) => Promise<ReaderNavigationTarget[]>;
};

type NavigationTargetParts = {
  decodedFragment?: string;
  documentHref: string;
  fragment?: string;
  originalHref: string;
};

type EpubCfiComparator = {
  compare: (first: string, second: string) => number;
};

type EpubRequest = (...args: unknown[]) => Promise<unknown>;

type EpubSectionAdapter = {
  canonical?: unknown;
  cfiFromElement?: (element: Element) => string;
  document?: Document;
  href?: unknown;
  index?: unknown;
  load?: (request?: EpubRequest) => Promise<unknown>;
  unload?: () => void;
  url?: unknown;
};

type EpubSpineAdapter = {
  each?: (callback: (section: unknown) => void) => void;
  epubcfi?: EpubCfiComparator;
  get: (target?: string | number) => unknown;
};

type EpubNavigationBook = EpubBook & {
  packaging?: {
    navPath?: unknown;
    ncxPath?: unknown;
  };
  spine: EpubSpineAdapter;
};

type InternalResolvedTarget = ReaderNavigationTarget & {
  fragment?: string;
  section?: EpubSectionAdapter;
};

type SectionDocumentLease = {
  document?: Document;
  release: () => void;
};

type TransientDocumentLoad = {
  attempted: boolean;
  document?: Document;
};

export function createReaderNavigationAdapter(book: EpubBook): ReaderNavigationAdapter {
  const adaptedBook = book as EpubNavigationBook;
  const navigationDocumentPaths = navigationDocumentPathsForBook(adaptedBook);
  const spineSections = collectSpineSections(adaptedBook.spine);
  const comparator = adaptedBook.spine.epubcfi;

  return {
    compareCfis(first, second) {
      if (!comparator) {
        return undefined;
      }

      try {
        const result = comparator.compare(first, second);
        return Number.isFinite(result) ? result : undefined;
      } catch {
        return undefined;
      }
    },
    resolveCfiPosition(cfi) {
      return resolveCfiPosition(adaptedBook, cfi);
    },
    resolveLocationTarget(href) {
      const target = resolveNavigationTarget(
        adaptedBook,
        href,
        navigationDocumentPaths,
        spineSections,
      );

      return {
        canonicalDocumentHref: target.canonicalDocumentHref,
        canonicalFullHref: target.canonicalFullHref,
      };
    },
    async resolveTargets(hrefs) {
      const targets = hrefs.map((href) =>
        resolveNavigationTarget(adaptedBook, href, navigationDocumentPaths, spineSections),
      );

      await captureAnchorPositions(adaptedBook, targets);

      return targets.map(
        ({ canonicalDocumentHref, canonicalFullHref, displayTarget, position }) => ({
          canonicalDocumentHref,
          canonicalFullHref,
          displayTarget,
          position,
        }),
      );
    },
  };
}

function resolveNavigationTarget(
  book: EpubNavigationBook,
  href: string,
  navigationDocumentPaths: readonly string[],
  spineSections: readonly EpubSectionAdapter[],
): InternalResolvedTarget {
  const parts = splitNavigationTarget(href);
  const cfi = navigationTargetCfi(parts);

  if (cfi) {
    const position = resolveCfiPosition(book, cfi) ?? { cfi };
    const section = sectionForCfi(book, cfi);
    const sectionHref = nonEmptyString(section?.href);

    return {
      canonicalDocumentHref: canonicalDocumentIdentity(sectionHref ?? parts.documentHref),
      canonicalFullHref: cfi,
      displayTarget: cfi,
      position,
      section,
    };
  }
  const candidates = documentCandidates(parts.documentHref, navigationDocumentPaths);
  const section = findSpineSection(book, candidates, spineSections);
  const sectionHref = nonEmptyString(section?.href);
  const canonicalDocumentHref = canonicalDocumentIdentity(
    sectionHref ?? candidates[0] ?? parts.documentHref,
  );
  const fragment = parts.decodedFragment;

  return {
    canonicalDocumentHref,
    canonicalFullHref: combineDocumentAndFragment(canonicalDocumentHref, fragment),
    displayTarget: sectionHref
      ? combineDocumentAndFragment(sectionHref, parts.fragment)
      : parts.originalHref,
    fragment,
    position: { spineIndex: finiteNumber(section?.index) },
    section,
  };
}

function resolveCfiPosition(
  book: EpubNavigationBook,
  cfi: string,
): ReaderNavigationPosition | undefined {
  const normalizedCfi = nonEmptyString(cfi);

  if (!normalizedCfi) {
    return undefined;
  }

  const section = sectionForCfi(book, normalizedCfi);
  if (!section) {
    return undefined;
  }

  return {
    cfi: normalizedCfi,
    spineIndex: finiteNumber(section.index),
  };
}

function sectionForCfi(book: EpubNavigationBook, cfi: string): EpubSectionAdapter | undefined {
  try {
    return asEpubSection(book.spine.get(cfi));
  } catch {
    return undefined;
  }
}

function navigationTargetCfi(parts: NavigationTargetParts): string | undefined {
  const directTarget = nonEmptyString(parts.originalHref);
  if (isEpubCfiString(directTarget)) {
    return directTarget;
  }

  const fragment = nonEmptyString(parts.decodedFragment);
  return isEpubCfiString(fragment) ? fragment : undefined;
}

function isEpubCfiString(value: string | undefined): value is string {
  return value?.startsWith("epubcfi(") === true && value.endsWith(")");
}

function documentCandidates(
  documentHref: string,
  navigationDocumentPaths: readonly string[],
): string[] {
  const candidates: string[] = [];
  const decodedDocumentHref = safeDecodeUri(documentHref);

  addCandidate(candidates, documentHref);
  addCandidate(candidates, decodedDocumentHref);
  addCandidate(candidates, normalizeDocumentPath(documentHref));
  addCandidate(candidates, normalizeDocumentPath(decodedDocumentHref));

  for (const navigationDocumentPath of navigationDocumentPaths) {
    if (!documentHref) {
      addCandidate(candidates, normalizeDocumentPath(navigationDocumentPath));
      addCandidate(candidates, normalizeDocumentPath(safeDecodeUri(navigationDocumentPath)));
      continue;
    }

    addCandidate(candidates, resolveRelativeDocumentPath(navigationDocumentPath, documentHref));
    addCandidate(
      candidates,
      resolveRelativeDocumentPath(navigationDocumentPath, decodedDocumentHref),
    );
  }

  return candidates;
}

function findSpineSection(
  book: EpubNavigationBook,
  candidates: readonly string[],
  spineSections: readonly EpubSectionAdapter[],
): EpubSectionAdapter | undefined {
  for (const candidate of candidates) {
    try {
      const section = asEpubSection(book.spine.get(candidate));

      if (section && sectionMatchesCandidate(book, section, candidate)) {
        return section;
      }
    } catch {
      // Continue through the remaining safe candidates.
    }
  }

  return spineSections.find((section) =>
    candidates.some((candidate) => sectionMatchesCandidate(book, section, candidate)),
  );
}

function sectionMatchesCandidate(
  book: EpubNavigationBook,
  section: EpubSectionAdapter,
  candidate: string,
): boolean {
  const candidateIdentities = documentIdentities(book, candidate);
  const sectionIdentities = [section.href, section.url, section.canonical]
    .map(nonEmptyString)
    .filter((value): value is string => value !== undefined)
    .flatMap((value) => documentIdentities(book, value));

  return sectionIdentities.some((identity) => candidateIdentities.includes(identity));
}

function documentIdentities(book: EpubNavigationBook, href: string): string[] {
  const identities: string[] = [];
  const decodedHref = safeDecodeUri(href);

  addCandidate(identities, canonicalDocumentIdentity(href));
  addCandidate(identities, canonicalDocumentIdentity(decodedHref));

  try {
    const resolved = book.resolve(href, true);

    if (typeof resolved === "string") {
      addCandidate(identities, canonicalDocumentIdentity(resolved));
    }
  } catch {
    // Relative identity matching remains available when resolution fails.
  }

  return identities;
}

async function captureAnchorPositions(
  book: EpubNavigationBook,
  targets: InternalResolvedTarget[],
): Promise<void> {
  const targetsByDocument = new Map<string, InternalResolvedTarget[]>();

  for (const target of targets) {
    const documentTargets = targetsByDocument.get(target.canonicalDocumentHref);

    if (documentTargets) {
      documentTargets.push(target);
    } else {
      targetsByDocument.set(target.canonicalDocumentHref, [target]);
    }
  }

  for (const documentTargets of targetsByDocument.values()) {
    const anchorTargets = documentTargets.filter(
      (target): target is InternalResolvedTarget & { fragment: string } =>
        target.fragment !== undefined,
    );
    const section = documentTargets.find((target) => target.section)?.section;

    if (anchorTargets.length === 0 || !section) {
      continue;
    }

    if (documentTargets.length < 2 && !section.document) {
      continue;
    }

    const lease = await acquireSectionDocument(book, section);

    try {
      if (!lease.document || typeof section.cfiFromElement !== "function") {
        continue;
      }

      for (const target of anchorTargets) {
        const anchor = findFragmentAnchor(lease.document, target.fragment);

        if (!anchor) {
          continue;
        }

        try {
          const cfi = section.cfiFromElement(anchor);

          if (nonEmptyString(cfi)) {
            target.position.cfi = cfi;
          }
        } catch {
          // Keep document and spine fallbacks when an anchor cannot produce a CFI.
        }
      }
    } finally {
      lease.release();
    }
  }
}

async function acquireSectionDocument(
  book: EpubNavigationBook,
  section: EpubSectionAdapter,
): Promise<SectionDocumentLease> {
  if (section.document) {
    return { document: section.document, release: noop };
  }

  const transientLoad = await loadTransientSectionDocument(book, section);

  if (section.document) {
    return { document: section.document, release: noop };
  }

  if (transientLoad.document) {
    return { document: transientLoad.document, release: noop };
  }

  if (transientLoad.attempted || typeof section.load !== "function") {
    return { release: noop };
  }

  if (section.document) {
    return { document: section.document, release: noop };
  }

  try {
    const request =
      typeof book.load === "function" ? (book.load.bind(book) as EpubRequest) : undefined;
    await section.load(request);
    const adapterLoadedDocument = section.document;

    return {
      document: adapterLoadedDocument,
      release: adapterLoadedDocument ? () => safelyUnloadSection(section) : noop,
    };
  } catch {
    if (section.document) {
      safelyUnloadSection(section);
    }

    return { release: noop };
  }
}

async function loadTransientSectionDocument(
  book: EpubNavigationBook,
  section: EpubSectionAdapter,
): Promise<TransientDocumentLoad> {
  const target = nonEmptyString(section.url) ?? nonEmptyString(section.href);

  if (!target || typeof book.load !== "function") {
    return { attempted: false };
  }

  try {
    return { attempted: true, document: asDocument(await book.load(target)) };
  } catch {
    return { attempted: true };
  }
}

function safelyUnloadSection(section: EpubSectionAdapter): void {
  try {
    section.unload?.();
  } catch {
    // Cleanup must not make navigation loading fail.
  }
}

function asDocument(value: unknown): Document | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("documentElement" in value) ||
    !("getElementById" in value)
  ) {
    return undefined;
  }

  return value as Document;
}

function noop(): void {}

function findFragmentAnchor(document: Document, fragment: string): Element | undefined {
  const fragmentCandidates = uniqueStrings([fragment, safeDecodeComponent(fragment)]);

  for (const candidate of fragmentCandidates) {
    const element = document.getElementById(candidate);

    if (element) {
      return element;
    }
  }

  for (const element of document.querySelectorAll("[name]")) {
    const name = element.getAttribute("name");

    if (name && fragmentCandidates.includes(name)) {
      return element;
    }
  }

  return undefined;
}

function navigationDocumentPathsForBook(book: EpubNavigationBook): string[] {
  return uniqueStrings([
    nonEmptyString(book.packaging?.navPath),
    nonEmptyString(book.packaging?.ncxPath),
  ]);
}

function collectSpineSections(spine: EpubSpineAdapter): EpubSectionAdapter[] {
  const sections: EpubSectionAdapter[] = [];

  try {
    spine.each?.((section) => {
      const adaptedSection = asEpubSection(section);

      if (adaptedSection) {
        sections.push(adaptedSection);
      }
    });
  } catch {
    return sections;
  }

  return sections;
}

function asEpubSection(value: unknown): EpubSectionAdapter | undefined {
  return typeof value === "object" && value !== null ? (value as EpubSectionAdapter) : undefined;
}

function splitNavigationTarget(href: string): NavigationTargetParts {
  const originalHref = href.trim();
  const hashIndex = originalHref.indexOf("#");
  const beforeFragment = hashIndex >= 0 ? originalHref.slice(0, hashIndex) : originalHref;
  const fragment = hashIndex >= 0 ? originalHref.slice(hashIndex + 1) : undefined;
  const queryIndex = beforeFragment.indexOf("?");
  const documentHref = (
    queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment
  ).trim();

  return {
    decodedFragment: fragment === undefined ? undefined : safeDecodeComponent(fragment),
    documentHref,
    fragment,
    originalHref,
  };
}

function resolveRelativeDocumentPath(baseDocumentHref: string, targetDocumentHref: string): string {
  const normalizedTarget = targetDocumentHref.trim().replace(/\\/g, "/");

  if (!normalizedTarget) {
    return "";
  }

  if (isAbsoluteUrl(normalizedTarget) || normalizedTarget.startsWith("/")) {
    return normalizeDocumentPath(normalizedTarget);
  }

  const baseParts = splitNavigationTarget(baseDocumentHref);
  const decodedBase = safeDecodeUri(baseParts.documentHref).replace(/\\/g, "/");

  if (isAbsoluteUrl(decodedBase)) {
    try {
      return normalizeDocumentPath(new URL(normalizedTarget, decodedBase).toString());
    } catch {
      return normalizeDocumentPath(normalizedTarget);
    }
  }

  const lastSlashIndex = decodedBase.lastIndexOf("/");
  const baseDirectory = lastSlashIndex >= 0 ? decodedBase.slice(0, lastSlashIndex + 1) : "";
  return normalizeDocumentPath(`${baseDirectory}${normalizedTarget}`);
}

function canonicalDocumentIdentity(href: string): string {
  const parts = splitNavigationTarget(href);
  return normalizeDocumentPath(safeDecodeUri(parts.documentHref));
}

function normalizeDocumentPath(path: string): string {
  const normalizedSlashes = path.trim().replace(/\\/g, "/");

  if (!normalizedSlashes) {
    return "";
  }

  if (isAbsoluteUrl(normalizedSlashes)) {
    try {
      const url = new URL(normalizedSlashes);
      url.pathname = collapsePathSegments(url.pathname);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return normalizedSlashes;
    }
  }

  return collapsePathSegments(normalizedSlashes);
}

function collapsePathSegments(path: string): string {
  const hasLeadingSlash = path.startsWith("/");
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previousSegment = segments.at(-1);

      if (previousSegment && previousSegment !== "..") {
        segments.pop();
      } else if (!hasLeadingSlash) {
        segments.push(segment);
      }
    } else {
      segments.push(segment);
    }
  }

  const collapsed = segments.join("/");
  return hasLeadingSlash ? `/${collapsed}` : collapsed;
}

function combineDocumentAndFragment(documentHref: string, fragment?: string): string {
  return fragment === undefined ? documentHref : `${documentHref}#${fragment}`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const uniqueValues: string[] = [];

  for (const value of values) {
    if (value && !uniqueValues.includes(value)) {
      uniqueValues.push(value);
    }
  }

  return uniqueValues;
}

function addCandidate(candidates: string[], candidate: string | undefined): void {
  const normalizedCandidate = candidate?.trim();

  if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
    candidates.push(normalizedCandidate);
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
