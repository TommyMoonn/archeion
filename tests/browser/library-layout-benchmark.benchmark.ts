import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Run only through library-layout-benchmark.config.ts, outside the contract suite.
// A browser comparison of production Library owners with synthetic IPC. Timing
// includes instrumentation; deviceScaleFactor is raster scale, not Windows zoom.
test.setTimeout(120_000);

for (const view of ["grid", "list"] as const) {
  for (const count of [50, 500, 3000]) {
    for (const scale of [1, 1.25, 1.5]) {
      test(`${view} ${count} books raster scale ${scale}`, async ({ browser }, info) => {
        const context = await browser.newContext({
          baseURL: info.project.use.baseURL,
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: scale,
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const records: unknown[] = [];
        try {
          await session.send("Performance.enable");
          await page.goto(
            `/tests/browser/fixtures/ui-stability.html?count=${count}&view=${view}&motion=off`,
            { waitUntil: "domcontentloaded" },
          );
          const collection = page.locator(view === "grid" ? ".book-grid" : ".book-list");
          await expect(collection).toBeVisible();
          await expect(collection).toHaveAttribute("data-windowed", "true");
          await page.evaluate(() => document.fonts.ready);
          // Capture raw DevTools events, including synchronous Layout events with
          // JS stacks. Aggregate CDP durations alone cannot identify forced layout.
          await session.send("Tracing.start", {
            categories: "devtools.timeline,disabled-by-default-devtools.timeline.stack",
            transferMode: "ReturnAsStream",
          });
          const layouts = (["comfortable", "compact"] as const).flatMap((density) =>
            (view === "grid" ? ["small", "medium", "large"] : ["medium"]).map((cardSize) => ({
              density,
              cardSize,
            })),
          );
          for (const { density, cardSize } of layouts) {
            for (let trial = 0; trial < 3; trial++) {
              // Alternate order to reduce systematic warm-cache/order bias.
              for (const auto of trial % 2 === 0 ? [false, true] : [true, false]) {
                // Retire the previous virtualizer measurement cache. An auto
                // trial's skipped 360px rows must not seed the visible baseline.
                await page.goto(
                  `/tests/browser/fixtures/ui-stability.html?count=${count}&view=${view}&motion=off`,
                  { waitUntil: "domcontentloaded" },
                );
                await expect(collection).toBeVisible();
                await page.evaluate(() => document.fonts.ready);
                const style = await page.addStyleTag({
                  content: auto
                    ? ".book-grid[data-windowed] .book-card__select { content-visibility:auto; contain-intrinsic-size:auto 360px; } .book-list[data-windowed] .book-row__select { content-visibility:auto; contain-intrinsic-size:auto 74px; }"
                    : ".book-grid[data-windowed] .book-card__select, .book-list[data-windowed] .book-row__select { content-visibility:visible; contain-intrinsic-size:none; }",
                });
                await page.setViewportSize({
                  width: trial === 1 ? 1000 : 1280,
                  height: trial === 1 ? 720 : 800,
                });
                await page.evaluate(
                  ({ density, cardSize }) => {
                    document.documentElement.dataset.density = density;
                    const grid = document.querySelector<HTMLElement>(".book-grid");
                    if (grid) grid.dataset.bookCardSize = cardSize;
                    const root = document.querySelector<HTMLElement>(".page-shell")!;
                    root.scrollTop = 0;
                  },
                  { density, cardSize },
                );
                await page.evaluate(async () => {
                  for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
                });
                const before = await session.send("Performance.getMetrics");
                const geometry = await collection.evaluate(async (node) => {
                  const root = node.closest<HTMLElement>(".page-shell")!;
                  const retained = node.firstElementChild as HTMLElement;
                  const mounted = new Set<Element>();
                  let mounts = 0;
                  const observer = new MutationObserver((entries) => {
                    for (const entry of entries)
                      for (const added of entry.addedNodes)
                        if (added instanceof Element && added.matches("[data-reader-book-id]")) {
                          mounts++;
                          mounted.add(added);
                        }
                  });
                  observer.observe(retained, { childList: true });
                  const frames: { dt: number; scrollTop: number; retained: number }[] = [];
                  let previous = performance.now();
                  // Repeated short forward/reverse bursts, then a distant jump.
                  for (let frame = 0; frame < 36; frame++) {
                    root.scrollTop += (Math.floor(frame / 6) % 2 === 0 ? 1 : -1) * 240;
                    await new Promise(requestAnimationFrame);
                    const now = performance.now();
                    frames.push({
                      dt: now - previous,
                      scrollTop: root.scrollTop,
                      retained: retained.querySelectorAll("[data-reader-book-id]").length,
                    });
                    previous = now;
                  }
                  root.scrollTop = (root.scrollHeight - root.clientHeight) / 2;
                  for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
                  const books = Array.from(
                    retained.querySelectorAll<HTMLElement>("[data-reader-book-id]"),
                  );
                  const bounds = root.getBoundingClientRect();
                  const book = books.find((book) => {
                    const rect = book.getBoundingClientRect();
                    return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
                  })!;
                  const button = book.querySelector<HTMLButtonElement>("button")!;
                  button.focus({ preventScroll: true });
                  const anchor = [];
                  for (let frame = 0; frame < 8; frame++) {
                    await new Promise(requestAnimationFrame);
                    anchor.push({
                      y: book.getBoundingClientRect().top - root.getBoundingClientRect().top,
                      scrollTop: root.scrollTop,
                      focused: document.activeElement === button,
                    });
                  }
                  const css = getComputedStyle(node);
                  const columns = node.classList.contains("book-grid")
                    ? css.gridTemplateColumns.split(/\s+/u).length
                    : 1;
                  const height = book.getBoundingClientRect().height;
                  const gap = parseFloat(css.rowGap) || 0;
                  const start = Number(node.getAttribute("data-window-start"));
                  const end = Number(node.getAttribute("data-window-end"));
                  const total = Number(node.getAttribute("data-window-total"));
                  const rows = Math.ceil(total / columns);
                  const renderedRows = Math.ceil((end - start) / columns);
                  const padding = getComputedStyle(retained);
                  const top = parseFloat(padding.paddingBlockStart);
                  const bottom = parseFloat(padding.paddingBlockEnd);
                  const expectedTop = Math.floor(start / columns) * (height + gap);
                  const expectedBottom = Math.max(
                    0,
                    rows * height +
                      Math.max(0, rows - 1) * gap -
                      expectedTop -
                      (renderedRows * height + Math.max(0, renderedRows - 1) * gap),
                  );
                  observer.disconnect();
                  return {
                    frames,
                    anchor,
                    mounts,
                    distinctMounts: mounted.size,
                    retained: books.length,
                    start,
                    end,
                    total,
                    columns,
                    height,
                    topSpacerError: top - expectedTop,
                    bottomSpacerError: bottom - expectedBottom,
                    visibility: getComputedStyle(button).contentVisibility,
                    selectedId: book.dataset.readerBookId,
                  };
                });
                const after = await session.send("Performance.getMetrics");
                const durations = Object.fromEntries(
                  ["LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount"].map(
                    (name) => [
                      name,
                      (after.metrics.find((metric) => metric.name === name)?.value ?? 0) -
                        (before.metrics.find((metric) => metric.name === name)?.value ?? 0),
                    ],
                  ),
                );
                records.push({ density, cardSize, trial, auto, durations, geometry });
                if (!auto) {
                  expect(geometry.retained).toBe(geometry.end - geometry.start);
                  if (count >= 500) expect(geometry.retained).toBeLessThan(100);
                  expect(Math.abs(geometry.topSpacerError)).toBeLessThanOrEqual(2);
                  expect(Math.abs(geometry.bottomSpacerError)).toBeLessThanOrEqual(2);
                  expect(geometry.anchor.every((frame) => frame.focused)).toBe(true);
                  const ys = geometry.anchor.map((frame) => frame.y);
                  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
                }
                expect(geometry.visibility).toBe(auto ? "auto" : "visible");
                await page.keyboard.press("Tab");
                expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
                if (trial === 0) {
                  const name = `${density}-${cardSize}-${auto ? "auto" : "visible"}-accessibility.yml`;
                  const snapshotPath = info.outputPath(name);
                  await writeFile(snapshotPath, await collection.ariaSnapshot());
                  await info.attach(name, { path: snapshotPath, contentType: "text/yaml" });
                }
                await style.evaluate((node) => node.parentNode?.removeChild(node));
              }
            }
          }
          const completed = new Promise<string>((resolve) => {
            session.once("Tracing.tracingComplete", (event) => resolve(event.stream!));
          });
          await session.send("Tracing.end");
          const stream = await completed;
          const chunks: Buffer[] = [];
          for (;;) {
            const chunk = await session.send("IO.read", { handle: stream });
            chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
            if (chunk.eof) break;
          }
          await session.send("IO.close", { handle: stream });
          await writeFile(info.outputPath("devtools-timeline.json"), Buffer.concat(chunks));
          await info.attach("devtools-timeline.json", {
            path: info.outputPath("devtools-timeline.json"),
            contentType: "application/json",
          });
        } finally {
          await writeFile(
            info.outputPath("layout-comparison.json"),
            JSON.stringify({ view, count, scale, records }),
          );
          await info.attach("layout-comparison.json", {
            body: JSON.stringify({ view, count, scale, records }),
            contentType: "application/json",
          });
          await context.close();
        }
      });
    }
  }
}
