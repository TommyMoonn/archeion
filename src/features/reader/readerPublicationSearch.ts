import type { Book as EpubBook } from "epubjs";
import type EpubSection from "epubjs/types/section";

import {
  createReaderNavigationAdapter,
  type ReaderNavigationAdapter,
} from "./readerNavigationAdapter";
import type { ReaderNavigationModel } from "./readerNavigationModel";

export const READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY = 2;
export const READER_PUBLICATION_SEARCH_RESULT_LIMIT = 200;
const READER_PUBLICATION_SEARCH_EXCERPT_CONTEXT = 72;

export type ReaderPublicationSearchPosition = Readonly<{
  matchIndex: number;
  spineIndex: number;
}>;

export type ReaderPublicationSearchExcerptMatch = Readonly<{
  end: number;
  start: number;
}>;

export type ReaderPublicationSearchResult = Readonly<{
  chapterId?: string;
  chapterLabel?: string;
  excerpt: string;
  excerptMatch: ReaderPublicationSearchExcerptMatch;
  id: string;
  matchedText: string;
  position: ReaderPublicationSearchPosition;
  target: string;
}>;

export type ReaderPublicationSearchFailureReason =
  "load-failed" | "document-unavailable" | "search-failed" | "target-resolution-failed";

export type ReaderPublicationSearchFailure = Readonly<{
  href?: string;
  reason: ReaderPublicationSearchFailureReason;
  spineIndex: number;
}>;

export type ReaderPublicationSearchCompleted = Readonly<{
  failures: readonly ReaderPublicationSearchFailure[];
  kind: "completed";
  results: readonly ReaderPublicationSearchResult[];
  truncated: boolean;
}>;

export type ReaderPublicationSearchOutcome =
  ReaderPublicationSearchCompleted | Readonly<{ kind: "cancelled" }>;

export type ReaderPublicationSearchOptions = Readonly<{
  maxResults?: number;
  signal?: AbortSignal;
}>;

export type ReaderPublicationSearchService = Readonly<{
  retire: () => void;
  search: (
    query: string,
    options?: ReaderPublicationSearchOptions,
  ) => Promise<ReaderPublicationSearchOutcome>;
}>;

type ReaderPublicationSearchSectionAccess = Readonly<{
  isSectionRendered: (section: EpubSection) => boolean;
  listSections: () => readonly EpubSection[];
  loadSection: (section: EpubSection) => Promise<void>;
}>;

type ReaderPublicationSearchDependencies = Readonly<{
  book: EpubBook;
  getNavigationModel?: () => ReaderNavigationModel;
  sections: ReaderPublicationSearchSectionAccess;
}>;

type TextBoundary = Readonly<{
  node: Text;
  offset: number;
}>;

type SearchableCharacter = Readonly<{
  end: TextBoundary;
  start: TextBoundary;
}>;

type SearchableDocument = Readonly<{
  characters: readonly SearchableCharacter[];
  text: string;
}>;

type RawSearchMatch = Readonly<{
  cfi: string;
  excerpt: string;
  excerptMatch: ReaderPublicationSearchExcerptMatch;
  matchedText: string;
  matchIndex: number;
  spineIndex: number;
}>;

type SectionSearchResult = Readonly<{
  failure?: ReaderPublicationSearchFailure;
  matches: readonly RawSearchMatch[];
}>;

type SectionPermitWaiter = {
  resolve: (release: (() => void) | undefined) => void;
  signal: AbortSignal;
};

type ReaderPublicationSearchSectionLease = Readonly<{
  release: () => void;
}>;

type ReaderPublicationSearchSectionAcquisition =
  | Readonly<{ kind: "acquired"; lease: ReaderPublicationSearchSectionLease }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "load-failed" }>;

type SearchOwnedSectionState = {
  consumers: number;
  loadPromise?: Promise<boolean>;
  loadSettled: boolean;
  section: EpubSection;
};

const EXTERNAL_SECTION_LEASE: ReaderPublicationSearchSectionLease = Object.freeze({
  release: () => undefined,
});

class ReaderPublicationSearchSectionLeaseOwner {
  private retired = false;
  private readonly states = new Map<EpubSection, SearchOwnedSectionState>();

  constructor(private readonly sections: ReaderPublicationSearchSectionAccess) {}

  acquire(
    section: EpubSection,
    signal: AbortSignal,
  ): Promise<ReaderPublicationSearchSectionAcquisition> {
    if (this.retired || signal.aborted) {
      return Promise.resolve({ kind: "cancelled" });
    }

    const existing = this.states.get(section);
    if (existing) {
      return this.acquireSearchOwnedState(existing, signal);
    }

    if (sectionIsLoaded(section) || this.sections.isSectionRendered(section)) {
      return Promise.resolve({ kind: "acquired", lease: EXTERNAL_SECTION_LEASE });
    }

    const state: SearchOwnedSectionState = {
      consumers: 0,
      loadSettled: false,
      section,
    };
    this.states.set(section, state);
    return this.acquireSearchOwnedState(state, signal);
  }

  retire(): void {
    if (this.retired) return;
    this.retired = true;
    for (const state of this.states.values()) {
      this.finalizeIfUnused(state);
    }
  }

  private acquireSearchOwnedState(
    state: SearchOwnedSectionState,
    signal: AbortSignal,
  ): Promise<ReaderPublicationSearchSectionAcquisition> {
    state.consumers += 1;
    const loadPromise = (state.loadPromise ??= this.loadSearchOwnedSection(state));

    return new Promise((resolve) => {
      let settled = false;
      const finish = (kind: "acquired" | "cancelled" | "load-failed") => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);

        if (kind !== "acquired") {
          this.releaseInterest(state);
          resolve({ kind });
          return;
        }

        let released = false;
        resolve({
          kind: "acquired",
          lease: Object.freeze({
            release: () => {
              if (released) return;
              released = true;
              this.releaseInterest(state);
            },
          }),
        });
      };
      const abort = () => finish("cancelled");

      if (this.retired || signal.aborted) {
        finish("cancelled");
        return;
      }

      signal.addEventListener("abort", abort, { once: true });
      void loadPromise.then((loaded) => {
        if (this.retired || signal.aborted) {
          finish("cancelled");
          return;
        }
        finish(loaded ? "acquired" : "load-failed");
      });
    });
  }

  private async loadSearchOwnedSection(state: SearchOwnedSectionState): Promise<boolean> {
    try {
      await this.sections.loadSection(state.section);
      return true;
    } catch {
      return false;
    } finally {
      state.loadSettled = true;
      this.finalizeIfUnused(state);
    }
  }

  private releaseInterest(state: SearchOwnedSectionState): void {
    state.consumers = Math.max(0, state.consumers - 1);
    this.finalizeIfUnused(state);
  }

  private finalizeIfUnused(state: SearchOwnedSectionState): void {
    if (!state.loadSettled || state.consumers > 0) return;
    if (this.states.get(state.section) !== state) return;

    this.states.delete(state.section);
    if (!this.sections.isSectionRendered(state.section)) {
      safelyUnloadSection(state.section);
    }
  }
}

class ReaderPublicationSearchSectionLimiter {
  private active = 0;
  private readonly waiters: SectionPermitWaiter[] = [];

  constructor(private readonly limit: number) {}

  acquire(signal: AbortSignal): Promise<(() => void) | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releasePermit());
    }

    return new Promise((resolve) => {
      const waiter: SectionPermitWaiter = { resolve, signal };
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      waiter.resolve = (release) => {
        signal.removeEventListener("abort", abort);
        resolve(release);
      };
      this.waiters.push(waiter);
    });
  }

  private releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        if (!waiter || waiter.signal.aborted) continue;
        waiter.resolve(this.releasePermit());
        return;
      }

      this.active = Math.max(0, this.active - 1);
    };
  }
}

const CANCELLED_OUTCOME: ReaderPublicationSearchOutcome = Object.freeze({ kind: "cancelled" });
const EMPTY_COMPLETED_OUTCOME: ReaderPublicationSearchCompleted = Object.freeze({
  failures: Object.freeze([]),
  kind: "completed",
  results: Object.freeze([]),
  truncated: false,
});

export function createReaderPublicationSearchService({
  book,
  getNavigationModel,
  sections,
}: ReaderPublicationSearchDependencies): ReaderPublicationSearchService {
  let retired = false;
  let generation = 0;
  let adapter: ReaderNavigationAdapter | null = null;
  const activeSearches = new Set<AbortController>();
  const sectionLimiter = new ReaderPublicationSearchSectionLimiter(
    READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY,
  );
  const sectionLeases = new ReaderPublicationSearchSectionLeaseOwner(sections);

  const retire = () => {
    if (retired) return;
    retired = true;
    generation += 1;
    sectionLeases.retire();
    for (const controller of activeSearches) controller.abort();
    activeSearches.clear();
  };

  const search = async (
    rawQuery: string,
    options: ReaderPublicationSearchOptions = {},
  ): Promise<ReaderPublicationSearchOutcome> => {
    if (retired) return CANCELLED_OUTCOME;

    const query = normalizeSearchText(rawQuery);
    if (!query) return EMPTY_COMPLETED_OUTCOME;

    const maxResults = normalizeResultLimit(options.maxResults);
    const searchGeneration = generation;
    const controller = new AbortController();
    activeSearches.add(controller);
    const detachExternalAbort = forwardAbort(options.signal, controller);

    const searchIsCancelled = () =>
      retired ||
      searchGeneration !== generation ||
      controller.signal.aborted ||
      options.signal?.aborted === true;

    try {
      if (searchIsCancelled()) return CANCELLED_OUTCOME;

      const publicationSections = sections
        .listSections()
        .filter((section) => section.linear !== false);
      const sectionResults = new Array<SectionSearchResult | undefined>(publicationSections.length);
      let nextSectionIndex = 0;

      async function worker(): Promise<void> {
        while (!searchIsCancelled()) {
          const publicationIndex = nextSectionIndex;
          nextSectionIndex += 1;
          const section = publicationSections[publicationIndex];
          if (!section) return;

          const releasePermit = await sectionLimiter.acquire(controller.signal);
          if (!releasePermit) return;
          try {
            if (searchIsCancelled()) return;
            sectionResults[publicationIndex] = await searchSection(
              section,
              query,
              maxResults + 1,
              publicationIndex,
              sectionLeases,
              controller.signal,
              searchIsCancelled,
            );
          } finally {
            releasePermit();
          }
        }
      }

      await Promise.all(
        Array.from(
          {
            length: Math.min(
              READER_PUBLICATION_SEARCH_SECTION_CONCURRENCY,
              publicationSections.length,
            ),
          },
          () => worker(),
        ),
      );

      if (searchIsCancelled()) return CANCELLED_OUTCOME;

      const rawMatches: RawSearchMatch[] = [];
      const failures: ReaderPublicationSearchFailure[] = [];
      for (const sectionResult of sectionResults) {
        if (!sectionResult) continue;
        if (sectionResult.failure) failures.push(sectionResult.failure);
        rawMatches.push(...sectionResult.matches);
      }

      const truncated = rawMatches.length > maxResults;
      const retainedMatches = rawMatches.slice(0, maxResults);
      if (retainedMatches.length === 0) {
        return freezeCompleted([], failures, truncated);
      }

      adapter ??= createReaderNavigationAdapter(book);
      const results: ReaderPublicationSearchResult[] = [];
      const targetFailureSections = new Set<number>();

      for (const match of retainedMatches) {
        if (searchIsCancelled()) return CANCELLED_OUTCOME;

        const target = adapter.resolveCfiTarget(match.cfi);
        if (!target) {
          targetFailureSections.add(match.spineIndex);
          continue;
        }

        const chapter = target.position.cfi
          ? getNavigationModel?.().findNearestChapter(target.position.cfi)
          : undefined;
        results.push(
          Object.freeze({
            ...(chapter ? { chapterId: chapter.id, chapterLabel: chapter.label } : {}),
            excerpt: match.excerpt,
            excerptMatch: match.excerptMatch,
            id: resultId(match.spineIndex, target.canonicalFullHref),
            matchedText: match.matchedText,
            position: Object.freeze({
              matchIndex: match.matchIndex,
              spineIndex: match.spineIndex,
            }),
            target: target.displayTarget,
          }),
        );
      }

      for (const spineIndex of targetFailureSections) {
        if (!failures.some((failure) => failure.spineIndex === spineIndex)) {
          failures.push(Object.freeze({ reason: "target-resolution-failed", spineIndex }));
        }
      }

      return freezeCompleted(results, failures, truncated);
    } finally {
      detachExternalAbort();
      activeSearches.delete(controller);
    }
  };

  return Object.freeze({ retire, search });
}

async function searchSection(
  section: EpubSection,
  query: string,
  matchLimit: number,
  publicationIndex: number,
  sectionLeases: ReaderPublicationSearchSectionLeaseOwner,
  signal: AbortSignal,
  cancelled: () => boolean,
): Promise<SectionSearchResult> {
  const spineIndex = finiteSpineIndex(section.index, publicationIndex);
  const href = nonEmptyString(section.href);
  const acquisition = await sectionLeases.acquire(section, signal);

  if (acquisition.kind === "cancelled") return { matches: [] };
  if (acquisition.kind === "load-failed") {
    return { matches: [], failure: sectionFailure("load-failed", spineIndex, href) };
  }

  try {
    if (cancelled()) return { matches: [] };
    if (!section.document) {
      return {
        matches: [],
        failure: sectionFailure("document-unavailable", spineIndex, href),
      };
    }

    try {
      return searchLoadedSection(section, query, matchLimit, spineIndex);
    } catch {
      return { matches: [], failure: sectionFailure("search-failed", spineIndex, href) };
    }
  } finally {
    acquisition.lease.release();
  }
}

function searchLoadedSection(
  section: EpubSection,
  query: string,
  matchLimit: number,
  spineIndex: number,
): SectionSearchResult {
  const document = section.document;
  if (!document) return { matches: [] };

  const searchable = searchableDocument(document);
  if (!searchable.text) return { matches: [] };

  const expression = new RegExp(escapeRegExp(query), "giu");
  const matches: RawSearchMatch[] = [];
  let targetFailure = false;
  let sourceMatchIndex = 0;

  for (const match of searchable.text.matchAll(expression)) {
    const start = match.index;
    const matchedText = match[0];
    const end = start + matchedText.length;
    const range = rangeForMatch(document, searchable.characters, start, end);
    if (!range) continue;

    try {
      const cfi = nonEmptyString(section.cfiFromRange(range));
      if (!cfi) {
        targetFailure = true;
        continue;
      }

      const excerpt = excerptForMatch(searchable.text, start, end);
      matches.push(
        Object.freeze({
          cfi,
          excerpt: excerpt.text,
          excerptMatch: excerpt.match,
          matchedText,
          matchIndex: sourceMatchIndex,
          spineIndex,
        }),
      );
      if (matches.length >= matchLimit) break;
    } catch {
      targetFailure = true;
    } finally {
      sourceMatchIndex += 1;
    }
  }

  return targetFailure
    ? {
        matches,
        failure: sectionFailure(
          "target-resolution-failed",
          spineIndex,
          nonEmptyString(section.href),
        ),
      }
    : { matches };
}

function searchableDocument(document: Document): SearchableDocument {
  const root = document.body ?? document.querySelector("body") ?? document.documentElement;
  if (!root) return { characters: [], text: "" };

  const walker = document.createTreeWalker(root, 4);
  const characters: SearchableCharacter[] = [];
  let text = "";
  let pendingWhitespace: { end: TextBoundary; start: TextBoundary } | undefined;
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (current.nodeType !== 3 || !textNodeIsSearchable(current as Text, root)) continue;
    const node = current as Text;

    for (let offset = 0; offset < node.data.length; offset += 1) {
      const character = node.data[offset] ?? "";
      if (isOrdinaryWhitespace(character)) {
        const boundary = { node, offset };
        if (text.length > 0) {
          pendingWhitespace = pendingWhitespace
            ? { ...pendingWhitespace, end: { node, offset: offset + 1 } }
            : { start: boundary, end: { node, offset: offset + 1 } };
        }
        continue;
      }

      if (pendingWhitespace) {
        text += " ";
        characters.push(
          Object.freeze({ start: pendingWhitespace.start, end: pendingWhitespace.end }),
        );
        pendingWhitespace = undefined;
      }

      text += character;
      characters.push(
        Object.freeze({
          start: Object.freeze({ node, offset }),
          end: Object.freeze({ node, offset: offset + 1 }),
        }),
      );
    }
  }

  return { characters, text };
}

function textNodeIsSearchable(node: Text, root: Element): boolean {
  let element = node.parentElement;
  while (element) {
    const name = element.localName.toLowerCase();
    if (name === "script" || name === "style" || name === "noscript" || name === "template") {
      return false;
    }
    if (element === root) break;
    element = element.parentElement;
  }
  return true;
}

function rangeForMatch(
  document: Document,
  characters: readonly SearchableCharacter[],
  start: number,
  end: number,
): Range | undefined {
  if (start < 0 || end <= start) return undefined;
  const first = characters[start];
  const last = characters[end - 1];
  if (!first || !last) return undefined;

  const range = document.createRange();
  range.setStart(first.start.node, first.start.offset);
  range.setEnd(last.end.node, last.end.offset);
  return range;
}

function excerptForMatch(
  text: string,
  start: number,
  end: number,
): Readonly<{ match: ReaderPublicationSearchExcerptMatch; text: string }> {
  const rawStart = Math.max(0, start - READER_PUBLICATION_SEARCH_EXCERPT_CONTEXT);
  const rawEnd = Math.min(text.length, end + READER_PUBLICATION_SEARCH_EXCERPT_CONTEXT);
  let excerptStart = rawStart;
  let excerptEnd = rawEnd;

  while (excerptStart < start && isOrdinaryWhitespace(text[excerptStart] ?? "")) {
    excerptStart += 1;
  }
  while (excerptEnd > end && isOrdinaryWhitespace(text[excerptEnd - 1] ?? "")) {
    excerptEnd -= 1;
  }

  const leadingEllipsis = excerptStart > 0 ? "…" : "";
  const trailingEllipsis = excerptEnd < text.length ? "…" : "";
  const excerpt = `${leadingEllipsis}${text.slice(excerptStart, excerptEnd)}${trailingEllipsis}`;
  const matchStart = leadingEllipsis.length + start - excerptStart;

  return Object.freeze({
    match: Object.freeze({ end: matchStart + end - start, start: matchStart }),
    text: excerpt,
  });
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function normalizeResultLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return READER_PUBLICATION_SEARCH_RESULT_LIMIT;
  }

  return Math.min(READER_PUBLICATION_SEARCH_RESULT_LIMIT, Math.max(1, Math.floor(value)));
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    controller.abort();
    return () => undefined;
  }

  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function freezeCompleted(
  results: readonly ReaderPublicationSearchResult[],
  failures: readonly ReaderPublicationSearchFailure[],
  truncated: boolean,
): ReaderPublicationSearchCompleted {
  return Object.freeze({
    failures: Object.freeze([...failures]),
    kind: "completed",
    results: Object.freeze([...results]),
    truncated,
  });
}

function sectionFailure(
  reason: ReaderPublicationSearchFailureReason,
  spineIndex: number,
  href?: string,
): ReaderPublicationSearchFailure {
  return Object.freeze({ ...(href ? { href } : {}), reason, spineIndex });
}

function resultId(spineIndex: number, canonicalTarget: string): string {
  return `search-result-${spineIndex + 1}:${encodeURIComponent(canonicalTarget)}`;
}

function sectionIsLoaded(section: EpubSection): boolean {
  return Boolean(section.document || section.contents);
}

function safelyUnloadSection(section: EpubSection): void {
  try {
    section.unload();
  } catch {
    // Search cleanup must not replace the completed or contained-failure outcome.
  }
}

function finiteSpineIndex(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isOrdinaryWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
