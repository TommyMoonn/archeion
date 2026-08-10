import type EpubSection from "epubjs/types/section";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import {
  READER_ANNOTATION_RECOVERY_CHAPTER_LIMIT,
  highlightHasRecoveryContext,
  highlightRecoveryCandidates,
  normalizeRecoveryText,
  recoverBookmarkChapterAnchor,
  recoveryRangeMatches,
  resolveContextHighlightCandidates,
  resolvePreferredHighlightCandidates,
  type ReaderAnnotationRecoveryResult,
  type ReaderHighlightRecoveryCandidate,
} from "./readerAnnotationRecovery";
import { ReaderAnnotationSectionLifecycle } from "./readerAnnotationSectionLifecycle";
import { highlightNavigationTarget } from "./readerAnnotationNavigation";
import { normalizeReaderChapterHref } from "./readerAnnotations";
import {
  normalizeReaderHighlightColor,
  readerHighlightStyles,
  type ReaderHighlightColor,
} from "./readerHighlights";
import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";

export type RenderedAnnotationAdapterOptions = {
  highlights: readonly HighlightAnnotation[];
  onAnchorInvalid?: (annotationId: string, anchorSignature: string) => Promise<boolean>;
  onCancelHighlightGesture: (annotationId: string) => void;
  onHighlightEvent: (annotationId: string, event: Event) => void;
};

type RenderedHighlight = {
  annotationId: string;
  color: ReaderHighlightColor;
  range: string;
  token: { active: boolean };
};

function sectionForHref(
  session: EpubAnnotationSessionAccess,
  href: string | undefined,
): EpubSection | undefined {
  if (!href?.trim()) return undefined;
  const target = normalizeReaderChapterHref(href, false);
  return session
    .listSections()
    .find((section) => normalizeReaderChapterHref(section.href, false) === target);
}

async function validateExactAnnotationAnchor(
  lifecycle: ReaderAnnotationSectionLifecycle,
  session: EpubAnnotationSessionAccess,
  annotation: Annotation,
  signal?: AbortSignal,
): Promise<ReaderAnnotationRecoveryResult> {
  const savedCfi = annotation.cfiRange?.trim();
  if (!savedCfi) return { kind: "detached", reason: "not-found" };

  let section: EpubSection | null;
  try {
    section = session.getSection(savedCfi) ?? null;
  } catch {
    return { kind: "detached", reason: "not-found" };
  }
  if (!section) return { kind: "detached", reason: "not-found" };

  try {
    const validation = await lifecycle.run(session, section, signal, async () => {
      try {
        const range = await session.getRange(savedCfi);
        return (
          annotation.type === "bookmark" || recoveryRangeMatches(range, annotation.selectedText)
        );
      } catch {
        return false;
      }
    });
    if (validation.kind === "cancelled") return validation;
    return validation.value
      ? {
          chapterHref: annotation.chapterHref,
          cfiRange: savedCfi,
          kind: "resolved",
          strategy: "exact-cfi",
        }
      : { kind: "detached", reason: "not-found" };
  } catch {
    return signal?.aborted ? { kind: "cancelled" } : { kind: "failed" };
  }
}

export class RenderedAnnotationAdapter {
  private generation = 0;
  private highlightsById = new Map<string, HighlightAnnotation>();
  private options: RenderedAnnotationAdapterOptions;
  private pendingInvalidReports = new Map<string, string>();
  private pendingValidations = new Map<string, string>();
  private recoveryController: AbortController | null = null;
  private rendered = new Map<string, RenderedHighlight>();
  private reportedInvalid = new Map<string, string>();
  private sectionLifecycle = new ReaderAnnotationSectionLifecycle();
  private session: EpubAnnotationSessionAccess | null = null;
  private validatedAnchors = new Map<string, string>();
  private validationController: AbortController | null = null;

  constructor(options: RenderedAnnotationAdapterOptions) {
    this.options = options;
    this.updateOptions(options);
  }

  updateOptions(options: RenderedAnnotationAdapterOptions): void {
    this.options = options;
    this.highlightsById = new Map(options.highlights.map((highlight) => [highlight.id, highlight]));
  }

  setSession(session: EpubAnnotationSessionAccess | null): void {
    if (this.session === session) return;
    this.cleanupSession();
    this.session = session;
    if (session) this.validationController = new AbortController();
  }

  reconcile(): void {
    const session = this.session;
    if (!session || this.validationController?.signal.aborted) return;

    this.pruneAnnotationState();
    const desired = new Map<
      string,
      { annotation: HighlightAnnotation; color: ReaderHighlightColor }
    >();
    const seenRanges = new Set<string>();

    for (const highlight of this.options.highlights) {
      if (highlight.anchorStatus === "detached") {
        this.clearAnnotationState(highlight.id);
        continue;
      }

      const range = highlight.cfiRange?.trim();
      if (!range || seenRanges.has(range)) continue;
      if (!highlightNavigationTarget(range)) {
        this.reportInvalidHighlight(highlight.id, `${range}\u0000invalid-cfi`);
        continue;
      }

      const signature = `${range}\u0000${normalizeRecoveryText(highlight.selectedText)}`;
      if (this.validatedAnchors.get(highlight.id) !== signature) {
        this.startValidation(session, highlight, signature);
        continue;
      }

      this.reportedInvalid.delete(highlight.id);
      seenRanges.add(range);
      desired.set(highlight.id, {
        annotation: highlight,
        color: normalizeReaderHighlightColor(highlight.color),
      });
    }

    for (const [annotationId, rendered] of this.rendered) {
      const next = desired.get(annotationId);
      if (
        !next ||
        next.color !== rendered.color ||
        next.annotation.cfiRange.trim() !== rendered.range
      ) {
        rendered.token.active = false;
        this.options.onCancelHighlightGesture(annotationId);
        session.removeAnnotation(rendered.range, "highlight");
        this.rendered.delete(annotationId);
      }
    }

    for (const [annotationId, { annotation, color }] of desired) {
      const range = annotation.cfiRange.trim();
      const current = this.rendered.get(annotationId);
      if (current?.range === range && current.color === color) continue;

      const token = { active: true };
      try {
        session.highlight(
          range,
          { annotationId },
          (event: Event) => {
            const rendered = this.rendered.get(annotationId);
            if (!token.active || rendered?.token !== token) return;
            this.options.onHighlightEvent(annotationId, event);
          },
          "archeion-highlight",
          readerHighlightStyles(color),
        );
        this.rendered.set(annotationId, { annotationId, color, range, token });
      } catch {
        token.active = false;
        this.reportInvalidHighlight(annotationId, `${range}\u0000render-failed`);
      }
    }
  }

  async resolveAnnotationAnchor(
    annotation: Annotation,
    attemptRecovery: boolean,
  ): Promise<ReaderAnnotationRecoveryResult> {
    const session = this.session;
    if (!session) return { kind: "failed" };

    this.recoveryController?.abort();
    const controller = new AbortController();
    this.recoveryController = controller;
    const generation = this.generation;
    const { signal } = controller;
    const ownsRecovery = () =>
      !signal.aborted && generation === this.generation && this.session === session;

    try {
      const exact = await validateExactAnnotationAnchor(
        this.sectionLifecycle,
        session,
        annotation,
        signal,
      );
      if (!ownsRecovery() || exact.kind === "cancelled") return { kind: "cancelled" };
      if (exact.kind === "resolved" || exact.kind === "failed") return exact;
      if (!attemptRecovery) return { kind: "detached", reason: "not-found" };

      const preferred = sectionForHref(session, annotation.chapterHref);
      if (annotation.type === "bookmark") {
        if (!preferred) return { kind: "detached", reason: "chapter-missing" };
        try {
          const recovered = await this.sectionLifecycle.run(session, preferred, signal, (loaded) =>
            recoverBookmarkChapterAnchor(annotation, loaded),
          );
          return recovered.kind === "cancelled" ? recovered : recovered.value;
        } catch {
          return ownsRecovery() ? { kind: "failed" } : { kind: "cancelled" };
        }
      }

      const sections = session.listSections();
      const candidates: ReaderHighlightRecoveryCandidate[] = [];
      if (preferred) {
        try {
          const evaluated = await this.sectionLifecycle.run(session, preferred, signal, (loaded) =>
            highlightRecoveryCandidates(annotation, loaded, signal),
          );
          if (evaluated.kind === "cancelled") return evaluated;
          candidates.push(...evaluated.value);
          const preferredResult = resolvePreferredHighlightCandidates(evaluated.value);
          if (preferredResult) return preferredResult;
        } catch {
          return ownsRecovery() ? { kind: "failed" } : { kind: "cancelled" };
        }
      }

      if (!ownsRecovery()) return { kind: "cancelled" };
      if (!highlightHasRecoveryContext(annotation)) {
        return {
          kind: "detached",
          reason: candidates.length > 1 ? "ambiguous" : "not-found",
        };
      }

      const fallback = sections
        .filter((section) => section !== preferred)
        .slice(0, READER_ANNOTATION_RECOVERY_CHAPTER_LIMIT);
      for (const section of fallback) {
        if (!ownsRecovery()) return { kind: "cancelled" };
        try {
          const evaluated = await this.sectionLifecycle.run(session, section, signal, (loaded) =>
            highlightRecoveryCandidates(annotation, loaded, signal),
          );
          if (evaluated.kind === "cancelled") return evaluated;
          candidates.push(...evaluated.value);
        } catch {
          return ownsRecovery() ? { kind: "failed" } : { kind: "cancelled" };
        }
      }

      if (!ownsRecovery()) return { kind: "cancelled" };
      const contextResult = resolveContextHighlightCandidates(candidates);
      if (contextResult) return contextResult;
      return {
        kind: "detached",
        reason: candidates.length > 0 ? "ambiguous" : "not-found",
      };
    } catch {
      return ownsRecovery() ? { kind: "failed" } : { kind: "cancelled" };
    } finally {
      if (this.recoveryController === controller) this.recoveryController = null;
    }
  }

  private startValidation(
    session: EpubAnnotationSessionAccess,
    highlight: HighlightAnnotation,
    signature: string,
  ): void {
    if (this.pendingValidations.get(highlight.id) === signature) return;
    const signal = this.validationController?.signal;
    if (!signal || signal.aborted) return;

    this.pendingValidations.set(highlight.id, signature);
    const generation = this.generation;
    void validateExactAnnotationAnchor(this.sectionLifecycle, session, highlight, signal)
      .then((result) => {
        if (signal.aborted || generation !== this.generation || this.session !== session) {
          return;
        }
        const candidate = this.highlightsById.get(highlight.id);
        const current =
          candidate &&
          candidate.anchorStatus !== "detached" &&
          `${candidate.cfiRange.trim()}\u0000${normalizeRecoveryText(candidate.selectedText)}` ===
            signature
            ? candidate
            : undefined;
        if (!current) return;

        if (result.kind === "resolved") {
          this.validatedAnchors.set(current.id, signature);
          this.reportedInvalid.delete(current.id);
        } else if (result.kind === "detached") {
          this.reportInvalidHighlight(current.id, signature);
        }
      })
      .finally(() => {
        if (this.pendingValidations.get(highlight.id) === signature) {
          this.pendingValidations.delete(highlight.id);
        }
        if (
          !signal.aborted &&
          generation === this.generation &&
          this.session === session &&
          this.validatedAnchors.get(highlight.id) === signature
        ) {
          this.reconcile();
        }
      });
  }

  private reportInvalidHighlight(annotationId: string, signature: string): void {
    if (
      this.reportedInvalid.get(annotationId) === signature ||
      this.pendingInvalidReports.get(annotationId) === signature
    ) {
      return;
    }
    const acknowledge = this.options.onAnchorInvalid;
    if (!acknowledge) return;

    const generation = this.generation;
    this.pendingInvalidReports.set(annotationId, signature);
    let acknowledgement: Promise<boolean>;
    try {
      acknowledgement = acknowledge(annotationId, signature);
    } catch {
      this.pendingInvalidReports.delete(annotationId);
      return;
    }

    void Promise.resolve(acknowledgement)
      .then((persisted) => {
        if (
          persisted &&
          generation === this.generation &&
          this.pendingInvalidReports.get(annotationId) === signature
        ) {
          this.reportedInvalid.set(annotationId, signature);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (
          generation === this.generation &&
          this.pendingInvalidReports.get(annotationId) === signature
        ) {
          this.pendingInvalidReports.delete(annotationId);
        }
      });
  }

  private pruneAnnotationState(): void {
    const ids = new Set(this.highlightsById.keys());
    for (const id of this.validatedAnchors.keys())
      if (!ids.has(id)) this.validatedAnchors.delete(id);
    for (const id of this.pendingValidations.keys())
      if (!ids.has(id)) this.pendingValidations.delete(id);
    for (const id of this.reportedInvalid.keys()) if (!ids.has(id)) this.reportedInvalid.delete(id);
    for (const id of this.pendingInvalidReports.keys()) {
      if (!ids.has(id)) this.pendingInvalidReports.delete(id);
    }
  }

  private clearAnnotationState(annotationId: string): void {
    this.validatedAnchors.delete(annotationId);
    this.pendingValidations.delete(annotationId);
    this.reportedInvalid.delete(annotationId);
    this.pendingInvalidReports.delete(annotationId);
  }

  private cleanupSession(): void {
    this.generation += 1;
    this.validationController?.abort();
    this.validationController = null;
    this.recoveryController?.abort();
    this.recoveryController = null;
    this.sectionLifecycle.invalidate();
    this.sectionLifecycle = new ReaderAnnotationSectionLifecycle();

    const session = this.session;
    for (const rendered of this.rendered.values()) {
      rendered.token.active = false;
      this.options.onCancelHighlightGesture(rendered.annotationId);
      session?.removeAnnotation(rendered.range, "highlight");
    }
    this.rendered.clear();
    this.validatedAnchors.clear();
    this.pendingValidations.clear();
    this.reportedInvalid.clear();
    this.pendingInvalidReports.clear();
    this.session = null;
  }
}
