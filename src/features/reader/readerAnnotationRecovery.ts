import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { normalizeReaderChapterHref } from "./readerAnnotations";

export const READER_ANNOTATION_CONTEXT_LENGTH = 96;
export const READER_ANNOTATION_RECOVERY_CHAPTER_LIMIT = 240;
const RECOVERY_MATCH_LIMIT = 40;

export type ReaderAnnotationRecoveryStrategy =
  "exact-cfi" | "chapter-text" | "context-text" | "chapter-start";

export type ReaderAnnotationRecoveryResult =
  | {
      chapterHref?: string;
      cfiRange: string;
      kind: "resolved";
      strategy: ReaderAnnotationRecoveryStrategy;
    }
  | {
      kind: "detached";
      reason: "ambiguous" | "chapter-missing" | "conflict" | "not-found";
    }
  | { kind: "cancelled" }
  | { kind: "failed" };

export type ReaderRecoverySection = {
  cfiFromElement: (element: Element) => string;
  cfiFromRange: (range: Range) => string;
  document: Document;
  href: string;
};

type TextPosition = {
  node: Text;
  offset: number;
};

type DocumentTextIndex = {
  positions: TextPosition[];
  text: string;
};

export type ReaderHighlightRecoveryCandidate = {
  chapterHref: string;
  cfiRange: string;
  contextMatches: number;
  contextTotal: number;
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function normalizeRecoveryText(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase();
}

export function readerSelectionContext(
  range: Range,
  contextLength = READER_ANNOTATION_CONTEXT_LENGTH,
): { contextAfter?: string; contextBefore?: string } {
  const document = range.startContainer.ownerDocument;
  if (!document) return {};
  const root = document.body ?? document.documentElement;
  if (!root || contextLength <= 0) return {};

  if (range.startContainer.nodeType === 3 && range.endContainer.nodeType === 3) {
    const walker = document.createTreeWalker(root, 4);
    const offsets = new Map<Node, number>();
    let documentText = "";
    let node = walker.nextNode();
    while (node) {
      offsets.set(node, documentText.length);
      documentText += node.textContent ?? "";
      node = walker.nextNode();
    }
    const startNodeOffset = offsets.get(range.startContainer);
    const endNodeOffset = offsets.get(range.endContainer);
    if (startNodeOffset !== undefined && endNodeOffset !== undefined) {
      const start = startNodeOffset + range.startOffset;
      const end = endNodeOffset + range.endOffset;
      const before = collapseWhitespace(documentText.slice(0, start)).slice(-contextLength);
      const after = collapseWhitespace(documentText.slice(end)).slice(0, contextLength);
      return {
        ...(after ? { contextAfter: after } : {}),
        ...(before ? { contextBefore: before } : {}),
      };
    }
  }

  try {
    const beforeRange = range.cloneRange();
    beforeRange.setStart(root, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = range.cloneRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEnd(root, root.childNodes.length);
    const before = collapseWhitespace(beforeRange.toString()).slice(-contextLength);
    const after = collapseWhitespace(afterRange.toString()).slice(0, contextLength);
    return {
      ...(after ? { contextAfter: after } : {}),
      ...(before ? { contextBefore: before } : {}),
    };
  } catch {
    return {};
  }
}

export function recoveryRangeMatches(range: Range, selectedText: string): boolean {
  const expected = normalizeRecoveryText(selectedText);
  return Boolean(expected && normalizeRecoveryText(range.toString()) === expected);
}

function documentTextIndex(document: Document): DocumentTextIndex | null {
  const root = document.body ?? document.documentElement;
  if (!root) return null;

  const walker = document.createTreeWalker(root, 4);
  const positions: TextPosition[] = [];
  let text = "";
  let previousWasWhitespace = false;
  let node = walker.nextNode();

  while (node) {
    if (node.nodeType === 3) {
      const textNode = node as Text;
      const value = textNode.data;
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset] ?? "";
        if (/\s/u.test(character)) {
          if (!previousWasWhitespace) {
            text += " ";
            positions.push({ node: textNode, offset });
          }
          previousWasWhitespace = true;
          continue;
        }

        const normalized = character.toLocaleLowerCase();
        text += normalized;
        for (let index = 0; index < normalized.length; index += 1) {
          positions.push({ node: textNode, offset });
        }
        previousWasWhitespace = false;
      }
    }
    node = walker.nextNode();
  }

  return text ? { positions, text } : null;
}

function rangeForMatch(
  document: Document,
  index: DocumentTextIndex,
  start: number,
  length: number,
): Range | null {
  const first = index.positions[start];
  const last = index.positions[start + length - 1];
  if (!first || !last) return null;

  try {
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.node.length, last.offset + 1));
    return range;
  } catch {
    return null;
  }
}

function contextMatchCount(
  index: DocumentTextIndex,
  start: number,
  selectedLength: number,
  highlight: HighlightAnnotation,
): { matches: number; total: number } {
  const before = normalizeRecoveryText(highlight.contextBefore ?? "");
  const after = normalizeRecoveryText(highlight.contextAfter ?? "");
  let matches = 0;
  let total = 0;

  if (before) {
    total += 1;
    const usefulBefore = before.slice(-READER_ANNOTATION_CONTEXT_LENGTH);
    const beforeWindow = normalizeRecoveryText(
      index.text.slice(
        Math.max(0, start - usefulBefore.length - READER_ANNOTATION_CONTEXT_LENGTH),
        start,
      ),
    );
    if (beforeWindow.endsWith(usefulBefore)) {
      matches += 1;
    }
  }

  if (after) {
    total += 1;
    const usefulAfter = after.slice(0, READER_ANNOTATION_CONTEXT_LENGTH);
    const afterStart = start + selectedLength;
    const afterWindow = normalizeRecoveryText(
      index.text.slice(
        afterStart,
        afterStart + usefulAfter.length + READER_ANNOTATION_CONTEXT_LENGTH,
      ),
    );
    if (afterWindow.startsWith(usefulAfter)) {
      matches += 1;
    }
  }

  return { matches, total };
}

export function highlightRecoveryCandidates(
  highlight: HighlightAnnotation,
  section: ReaderRecoverySection,
  signal?: AbortSignal,
): ReaderHighlightRecoveryCandidate[] {
  if (signal?.aborted) return [];
  const query = normalizeRecoveryText(highlight.selectedText);
  const index = documentTextIndex(section.document);
  if (!query || !index) return [];

  const matches: ReaderHighlightRecoveryCandidate[] = [];
  let offset = index.text.indexOf(query);
  while (offset >= 0 && matches.length < RECOVERY_MATCH_LIMIT) {
    if (signal?.aborted) return [];
    const range = rangeForMatch(section.document, index, offset, query.length);
    if (range) {
      try {
        const context = contextMatchCount(index, offset, query.length, highlight);
        matches.push({
          chapterHref: section.href,
          cfiRange: section.cfiFromRange(range),
          contextMatches: context.matches,
          contextTotal: context.total,
        });
      } catch {
        // A malformed DOM location is ignored without discarding the annotation.
      }
    }
    offset = index.text.indexOf(query, offset + Math.max(1, query.length));
  }

  return matches;
}

function uniqueConfidentCandidate(candidates: readonly ReaderHighlightRecoveryCandidate[]) {
  const confident = candidates.filter(
    (candidate) =>
      candidate.contextTotal > 0 && candidate.contextMatches === candidate.contextTotal,
  );
  return confident.length === 1 ? confident[0] : undefined;
}

function resolvedCandidate(
  candidate: ReaderHighlightRecoveryCandidate,
  strategy: "chapter-text" | "context-text",
): ReaderAnnotationRecoveryResult {
  return {
    chapterHref: candidate.chapterHref,
    cfiRange: candidate.cfiRange,
    kind: "resolved",
    strategy,
  };
}

export function highlightHasRecoveryContext(highlight: HighlightAnnotation): boolean {
  return Boolean(
    normalizeRecoveryText(highlight.contextBefore ?? "") ||
    normalizeRecoveryText(highlight.contextAfter ?? ""),
  );
}

export function resolvePreferredHighlightCandidates(
  candidates: readonly ReaderHighlightRecoveryCandidate[],
): ReaderAnnotationRecoveryResult | undefined {
  if (candidates.length === 1) return resolvedCandidate(candidates[0], "chapter-text");
  const confident = uniqueConfidentCandidate(candidates);
  return confident ? resolvedCandidate(confident, "context-text") : undefined;
}

export function resolveContextHighlightCandidates(
  candidates: readonly ReaderHighlightRecoveryCandidate[],
): ReaderAnnotationRecoveryResult | undefined {
  const confident = uniqueConfidentCandidate(candidates);
  return confident ? resolvedCandidate(confident, "context-text") : undefined;
}

export function recoverHighlightTextAnchor(
  highlight: HighlightAnnotation,
  sections: readonly ReaderRecoverySection[],
  signal?: AbortSignal,
): ReaderAnnotationRecoveryResult {
  if (signal?.aborted) return { kind: "cancelled" };
  const chapterHref = highlight.chapterHref
    ? normalizeReaderChapterHref(highlight.chapterHref, false)
    : undefined;
  const boundedSections = sections.slice(0, READER_ANNOTATION_RECOVERY_CHAPTER_LIMIT);
  const chapterSections = chapterHref
    ? boundedSections.filter(
        (section) => normalizeReaderChapterHref(section.href, false) === chapterHref,
      )
    : [];
  const chapterCandidates = chapterSections.flatMap((section) =>
    highlightRecoveryCandidates(highlight, section, signal),
  );

  if (signal?.aborted) return { kind: "cancelled" };
  const preferredResult = resolvePreferredHighlightCandidates(chapterCandidates);
  if (preferredResult) return preferredResult;

  const hasContext = highlightHasRecoveryContext(highlight);
  if (!hasContext) {
    return {
      kind: "detached",
      reason: chapterCandidates.length > 1 ? "ambiguous" : "not-found",
    };
  }

  const allCandidates = boundedSections.flatMap((section) =>
    highlightRecoveryCandidates(highlight, section, signal),
  );
  if (signal?.aborted) return { kind: "cancelled" };
  const contextResult = resolveContextHighlightCandidates(allCandidates);
  if (contextResult) return contextResult;

  return {
    kind: "detached",
    reason: allCandidates.length > 0 ? "ambiguous" : "not-found",
  };
}

export function recoverBookmarkChapterAnchor(
  bookmark: BookmarkAnnotation,
  section: ReaderRecoverySection | undefined,
): ReaderAnnotationRecoveryResult {
  if (!section) return { kind: "detached", reason: "chapter-missing" };
  const root = section.document.body ?? section.document.documentElement;
  if (!root) return { kind: "detached", reason: "chapter-missing" };

  try {
    return {
      chapterHref: section.href || bookmark.chapterHref,
      cfiRange: section.cfiFromElement(root),
      kind: "resolved",
      strategy: "chapter-start",
    };
  } catch {
    return { kind: "detached", reason: "chapter-missing" };
  }
}
