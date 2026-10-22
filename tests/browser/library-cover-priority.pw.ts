import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html";

type CoverEntry = { id: string; entered: number; ready: number | null; left?: number };
declare global {
  interface Window {
    coverTrackedUrls: Set<string>;
    coverPriorityProbe: {
      entries: CoverEntry[];
      starts: Array<{ id: string; time: number }>;
      live: Set<string>;
      activeFiles: number;
      peakFiles: number;
      activeDecodes: number;
      peakDecodes: number;
      stop: () => void;
    };
  }
}

async function installPriorityProbe(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>(".page-shell")!;
    const probe: Window["coverPriorityProbe"] = {
      entries: [],
      starts: [],
      live: window.coverTrackedUrls,
      activeFiles: 0,
      peakFiles: 0,
      activeDecodes: 0,
      peakDecodes: 0,
      stop: () => undefined,
    };
    window.coverPriorityProbe = probe;
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command !== "load_epub_cover") return invoke(command, args);
      probe.starts.push({ id: String(args.bookId), time: performance.now() });
      probe.activeFiles++;
      probe.peakFiles = Math.max(probe.peakFiles, probe.activeFiles);
      try {
        // Simulate non-cancellable native lookup, including after card retirement.
        await new Promise((resolve) => setTimeout(resolve, 160));
        return await invoke(command, args);
      } finally {
        probe.activeFiles--;
      }
    };
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      probe.activeDecodes++;
      probe.peakDecodes = Math.max(probe.peakDecodes, probe.activeDecodes);
      let observer: MutationObserver | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          timer = setTimeout(resolve, 80);
          observer = new MutationObserver(() => {
            if (!this.getAttribute("src")) reject(new Error("Retired delayed decode"));
          });
          observer.observe(this, { attributes: true, attributeFilter: ["src"] });
        });
        await decode.call(this);
      } finally {
        clearTimeout(timer);
        observer?.disconnect();
        probe.activeDecodes--;
      }
    };
    const visible = new Map<string, CoverEntry>();
    let raf = 0;
    const sample = () => {
      const bounds = host.getBoundingClientRect();
      const current = new Set<string>();
      for (const card of document.querySelectorAll<HTMLElement>("[data-reader-book-id]")) {
        const cover = card.querySelector<HTMLElement>(".book-cover");
        if (!cover) continue;
        const rect = cover.getBoundingClientRect();
        if (
          rect.bottom <= Math.max(bounds.top, 0) ||
          rect.top >= Math.min(bounds.bottom, innerHeight)
        )
          continue;
        const id = card.dataset.readerBookId!;
        current.add(id);
        let entry = visible.get(id);
        if (!entry) {
          entry = { id, entered: performance.now(), ready: null };
          visible.set(id, entry);
          if (probe.entries.length < 2000) probe.entries.push(entry);
        }
        if (cover.dataset.coverState === "available" && entry.ready === null)
          entry.ready = performance.now();
      }
      for (const [id, entry] of visible) {
        if (!current.has(id)) {
          entry.left = performance.now();
          visible.delete(id);
        }
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    probe.stop = () => {
      cancelAnimationFrame(raf);
      internals.invoke = invoke;
      HTMLImageElement.prototype.decode = decode;
    };
  });
}

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  const diagnostic = await page.evaluate(() => {
    const probe = window.coverPriorityProbe;
    if (!probe) return null;
    return {
      entries: probe.entries,
      starts: probe.starts,
      peakFiles: probe.peakFiles,
      peakDecodes: probe.peakDecodes,
      activeFiles: probe.activeFiles,
      activeDecodes: probe.activeDecodes,
      covers: [...document.querySelectorAll<HTMLElement>("[data-reader-book-id]")].map((card) => ({
        id: card.dataset.readerBookId,
        state: card.querySelector<HTMLElement>(".book-cover")?.dataset.coverState,
        rect: card.querySelector(".book-cover")?.getBoundingClientRect().toJSON(),
      })),
    };
  });
  if (diagnostic)
    await info.attach("priority-diagnostic", {
      body: JSON.stringify(diagnostic),
      contentType: "application/json",
    });
});

for (const view of ["grid", "list"] as const) {
  for (const count of [50, 500, 3000]) {
    test(`${view} prioritizes visible covers under delayed lookup/decode at ${count} books`, async ({
      page,
    }, info) => {
      await page.addInitScript(() => {
        window.coverTrackedUrls = new Set();
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          window.coverTrackedUrls.add(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          window.coverTrackedUrls.delete(url);
          revoke(url);
        };
      });
      await page.goto(`${fixture}?count=${count}&motion=off`);
      await expect(page.locator(".book-grid")).toBeVisible();
      await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
      await expect(page.locator(`.book-${view}`)).toBeVisible();
      await expect(page.locator("[data-cover-state=available]").first()).toBeVisible();
      await installPriorityProbe(page);
      await page.locator(".page-shell").evaluate(async (node) => {
        const step = node.clientHeight * 0.65;
        // Continuous rapid forward travel and reversal, with a frame at each step.
        for (const index of [
          ...Array.from({ length: 12 }, (_, i) => i + 1),
          ...Array.from({ length: 10 }, (_, i) => 11 - i),
        ]) {
          node.scrollTop = Math.min(node.scrollHeight - node.clientHeight, index * step);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.6;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      const visibleCount = await page.evaluate(() => {
        const host = document.querySelector(".page-shell")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(".book-cover")].filter((cover) => {
          const rect = cover.getBoundingClientRect();
          return rect.bottom > host.top && rect.top < Math.min(host.bottom, innerHeight);
        }).length;
      });
      // One outstanding wave of non-cancellable IPC, then four-slot visible waves.
      // The 300ms allowance covers observer delivery, React commit and test sampling.
      const readinessBudget = (1 + Math.ceil(visibleCount / 4)) * (160 + 80) + 300;
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const host = document.querySelector(".page-shell")!.getBoundingClientRect();
              return [...document.querySelectorAll<HTMLElement>(".book-cover")].filter((cover) => {
                const rect = cover.getBoundingClientRect();
                return (
                  rect.bottom > host.top &&
                  rect.top < Math.min(host.bottom, innerHeight) &&
                  cover.dataset.coverState !== "available"
                );
              }).length;
            }),
          { timeout: readinessBudget, intervals: [32] },
        )
        .toBe(0);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      const result = await page.evaluate(() => {
        const probe = window.coverPriorityProbe;
        return {
          entries: probe.entries,
          starts: probe.starts,
          peakFiles: probe.peakFiles,
          peakDecodes: probe.peakDecodes,
          live: probe.live.size,
          mounted: document.querySelectorAll(".book-cover").length,
        };
      });
      const settled = result.entries.filter(
        (entry) => entry.left === undefined && entry.ready !== null,
      );
      const latencies = settled.map((entry) => entry.ready! - entry.entered);
      expect(settled.length).toBe(visibleCount);
      expect(result.starts.length).toBeGreaterThan(0);
      expect(Math.max(...latencies)).toBeLessThanOrEqual(readinessBudget);
      expect(result.peakFiles).toBeLessThanOrEqual(4);
      expect(result.peakDecodes).toBeLessThanOrEqual(4);
      expect(result.live).toBeLessThanOrEqual(result.mounted + 48);
      await info.attach("delayed-visible-readiness", {
        body: JSON.stringify({ view, count, visibleCount, readinessBudget, latencies, ...result }),
        contentType: "application/json",
      });
      await page.evaluate(() => window.coverPriorityProbe.stop());
    });
  }
}

for (const appearance of ["light", "dark"] as const) {
  test(`${appearance} delayed cover keeps its normal surface without a skeleton or geometry change`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode;
      const pending: Array<() => void> = [];
      Object.assign(window, {
        releaseCoverDecode: () => pending.splice(0).forEach((resolve) => resolve()),
      });
      HTMLImageElement.prototype.decode = async function () {
        await new Promise<void>((resolve) => pending.push(resolve));
        await decode.call(this);
      };
    });
    await page.goto(`${fixture}?count=2&theme=${appearance}`);
    const cover = page.locator(".book-card .book-cover").first();
    await expect(cover).toHaveAttribute("data-cover-state", "loading");
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", appearance);
    const observed = await cover.evaluate((node) => {
      const style = getComputedStyle(node);
      const swatch = document.createElement("div");
      swatch.style.background = "var(--surface)";
      node.append(swatch);
      const expected = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        expected,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      };
    });
    expect(observed.background).toBe(observed.expected);
    expect(observed.image).toContain("linear-gradient");
    await expect(cover.locator(".book-cover__loading")).toHaveCount(0);
    await expect(cover.locator("img")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${appearance}-held-cover.png`) });
    await page.evaluate(() =>
      (window as unknown as { releaseCoverDecode: () => void }).releaseCoverDecode(),
    );
    await expect(cover).toHaveAttribute("data-cover-state", "available");
    const ready = await cover.boundingBox();
    expect(ready!.width).toBe(observed.width);
    expect(ready!.height).toBe(observed.height);
    await cover.locator("img").evaluate((img) => img.dispatchEvent(new Event("error")));
    await expect(cover).toHaveAttribute("data-cover-state", "unavailable");
    const fallback = await cover.evaluate((node) => {
      const swatch = document.createElement("div");
      swatch.style.background = "var(--surface)";
      node.append(swatch);
      const expected = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        expected,
        image: style.backgroundImage,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        animation: style.animationName,
        transition: style.transitionProperty,
      };
    });
    expect(fallback.background).toBe(fallback.expected);
    expect(fallback.image).toContain("linear-gradient");
    expect(fallback.width).toBe(observed.width);
    expect(fallback.height).toBe(observed.height);
    expect(fallback.animation).toBe("none");
    expect(fallback.transition).not.toContain("opacity");
    await info.attach("cover-surfaces", {
      body: JSON.stringify({ appearance, loading: observed, ready, fallback }),
      contentType: "application/json",
    });
  });
}
