import type { EpubAnnotationSessionAccess } from "./epubSessionInteractionAccess";

export const READER_SEARCH_MATCH_EMPHASIS_CLASS = "archeion-search-match-emphasis";

export type ReaderSearchMatchEmphasisOwner = Readonly<{
  clear: () => void;
  setSession: (session: EpubAnnotationSessionAccess | null) => void;
  show: (target: string) => boolean;
}>;

export class ReaderSearchMatchEmphasis implements ReaderSearchMatchEmphasisOwner {
  private activeTarget: string | undefined;
  private session: EpubAnnotationSessionAccess | null = null;

  setSession(session: EpubAnnotationSessionAccess | null): void {
    if (this.session === session) return;
    this.clear();
    this.session = session;
  }

  show(rawTarget: string): boolean {
    const target = rawTarget.trim();
    const session = this.session;
    if (!target || !session) return false;
    if (this.activeTarget === target) return true;

    this.clear();
    try {
      session.underline(
        target,
        { transient: "reader-search-match" },
        undefined,
        READER_SEARCH_MATCH_EMPHASIS_CLASS,
      );
      this.activeTarget = target;
      return true;
    } catch {
      this.activeTarget = undefined;
      return false;
    }
  }

  clear(): void {
    const target = this.activeTarget;
    this.activeTarget = undefined;
    if (!target || !this.session) return;

    try {
      this.session.removeAnnotation(target, "underline");
    } catch {
      // Transient emphasis cleanup must not interfere with Reader navigation or teardown.
    }
  }
}
