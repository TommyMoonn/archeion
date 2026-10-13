import ContinuousViewManager, { type ResidentView } from "epubjs/src/managers/continuous/index.js";
import type Section from "epubjs/types/section";

/** epub.js 0.3.93 seam: retain its loading and compensated view erasure. */
export class ReaderContinuousViewManager extends ContinuousViewManager {
  private ownsSession = () => true;
  private onLoadError: (error: unknown) => void = () => undefined;
  private retired = false;
  private previousOffset = 0;
  private travelDirection = 1;
  private navigating = 0;
  private readonly loading = new Map<ResidentView, Promise<unknown>>();

  setSessionOwner(
    ownsSession: () => boolean,
    onLoadError: (error: unknown) => void = () => undefined,
  ): void {
    this.ownsSession = ownsSession;
    this.onLoadError = onLoadError;
  }

  private isSessionCurrent(): boolean {
    return !this.retired && this.ownsSession();
  }

  private warm(view: ResidentView): boolean {
    const viewport = this.container.getBoundingClientRect();
    const bounds = view.element.getBoundingClientRect();
    const horizontal = this.settings.axis === "horizontal";
    const size = horizontal ? viewport.width : viewport.height;
    const start = horizontal ? viewport.left : viewport.top;
    const end = horizontal ? viewport.right : viewport.bottom;
    const viewStart = horizontal ? bounds.left : bounds.top;
    const viewEnd = horizontal ? bounds.right : bounds.bottom;
    // Two screens behind and three ahead. A large chapter remains one view;
    // tiny chapters share a spatial budget instead of an arbitrary section cap.
    const above = size * (this.travelDirection < 0 ? 3 : 2);
    const below = size * (this.travelDirection < 0 ? 2 : 3);
    const selection = view.contents?.document.getSelection();
    return (
      (viewEnd > start - above && viewStart < end + below) ||
      Boolean(selection && !selection.isCollapsed)
    );
  }

  private scrollOffset(): number {
    return this.settings.axis === "horizontal"
      ? this.container.scrollLeft
      : this.container.scrollTop;
  }

  private precedesViewport(view: ResidentView): boolean {
    const bounds = view.element.getBoundingClientRect();
    const viewport = this.container.getBoundingClientRect();
    if (this.settings.axis !== "horizontal") return bounds.bottom <= viewport.top;
    return this.settings.direction === "rtl"
      ? bounds.left >= viewport.right
      : bounds.right <= viewport.left;
  }

  override erase(view: ResidentView, above?: boolean): void {
    // The vendor clears contents during erase. Release document-owned actions
    // while the outgoing view still exposes its document and anchors.
    this.emit("reader-view-retiring", view);
    super.erase(view, above);
  }

  override async display(section: Section, target?: string | number): Promise<void> {
    if (!this.isSessionCurrent()) throw new Error("Reader session retired");
    this.navigating += 1;
    try {
      const previous = [...(this.views?.all() ?? [])];
      let destination = previous.find((view) => view.section.index === section.index);
      const prepare = previous.length > 0 && !destination?.displayed;
      if (prepare) {
        // Preserve the current passage while an evicted navigation target mounts.
        destination ??= this.append(section);
        await destination.display(this.request);
        if (!this.isSessionCurrent() || !this.views.all().includes(destination))
          throw new Error("Reader navigation retired");
        destination.show();
      }
      const displayed = super.display(section, target);
      if (prepare) {
        // The vendor moves synchronously to the ready target. Remove the old
        // window before fill(), so distant spine sections cannot become neighbors.
        for (const view of previous) {
          if (view === destination || !this.views.all().includes(view)) continue;
          this.erase(view, this.precedesViewport(view));
          this.emit("removed", view);
        }
      }
      await displayed;
    } finally {
      this.navigating -= 1;
    }
  }

  override async update(): Promise<void> {
    if (!this.isSessionCurrent()) return;
    const offset = this.scrollOffset();
    if (offset !== this.previousOffset)
      this.travelDirection = offset > this.previousOffset ? 1 : -1;
    this.previousOffset = offset;
    const views = [...this.views.all()];
    const required = views.filter((view) => this.warm(view));
    await Promise.all(
      required.map(async (view) => {
        if (!view.displayed) {
          let pending = this.loading.get(view);
          if (!pending) {
            pending = view.display(this.request);
            this.loading.set(view, pending);
            this.emit("reader-residency", "loading", view);
          }
          try {
            await pending;
          } catch (error) {
            if (this.isSessionCurrent()) this.onLoadError(error);
            return;
          } finally {
            if (this.loading.get(view) === pending) this.loading.delete(view);
          }
        }
        if (this.isSessionCurrent() && this.views.all().includes(view) && view.displayed)
          view.show();
      }),
    );
    if (!this.isSessionCurrent() || this.navigating > 0) return;
    // Re-evaluate after awaited content hooks. Never queue an unconditional
    // destroy that can execute after the user has reversed onto that chapter.
    for (const view of views) {
      if (!this.views.all().includes(view) || this.loading.has(view) || this.warm(view)) continue;
      this.erase(view, this.precedesViewport(view));
      this.emit("removed", view);
      this.emit("reader-residency", "unloaded", view);
    }
    // Stock trim retains an unloaded placeholder on either side. A scrollbar
    // seek can expose that placeholder before its iframe loads. Retire the whole
    // offscreen view through stock erase instead, including its above compensation.
    this.previousOffset = this.scrollOffset();
    this.emit(
      "reader-residency",
      "settled",
      required.map((view) => view.section.index),
    );
  }

  override destroy(): void {
    this.retired = true;
    this.loading.clear();
    super.destroy();
  }
}
