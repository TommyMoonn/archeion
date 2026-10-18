import { Book } from "epubjs";

// Opt-in synthetic test boundary: hold a real seek-generation source response
// while its Reader session retires. No production rejection handler is changed.
export function probeReaderSectionLoads() {
  const originalLoad = Book.prototype.load;
  const originalDestroy = Book.prototype.destroy;
  const generations = new WeakSet<Book>();
  const events: Array<{ kind: string; caller?: string }> = [];
  const heldBooks = new WeakSet<Book>();
  let held = false;
  let responseReady = false;
  let released = false;
  let destroyed = false;
  let release: (() => void) | undefined;

  Book.prototype.load = function (path) {
    if (!generations.has(this)) {
      generations.add(this);
      const generate = this.locations.generate;
      this.locations.generate = function (...args) {
        const stack = new Error().stack ?? "";
        events.push({
          kind: "generation",
          caller: stack.includes("readerSeekMap") ? "ReaderSeekMap.generate" : "other",
        });
        return generate.apply(this, args);
      };
    }
    const stack = new Error().stack ?? "";
    const response = originalLoad.call(this, path);
    if (held || !stack.includes("Locations.process") || !/\.xhtml$/.test(path)) return response;
    held = true;
    heldBooks.add(this);
    events.push({ kind: "held", caller: "Locations.process -> Section.load -> Book.load" });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return response.then(async (document) => {
      responseReady = true;
      events.push({ kind: "response-ready" });
      await gate;
      events.push({ kind: "response-released" });
      return document;
    });
  };
  Book.prototype.destroy = function () {
    if (heldBooks.has(this)) {
      destroyed = true;
      events.push({ kind: "book-destroyed" });
    }
    return originalDestroy.call(this);
  };

  return {
    waiting: () => responseReady && !released,
    release: () => {
      released = true;
      release?.();
    },
    snapshot: () => ({ destroyed, released, events: events.map((event) => ({ ...event })) }),
    dispose: () => {
      release?.();
      Book.prototype.load = originalLoad;
      Book.prototype.destroy = originalDestroy;
    },
  };
}
