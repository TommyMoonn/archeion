import { expect, test } from "@playwright/test";

test("preparation follows mounted views across scrolling, equivalent settings and final progress flush", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("/tests/browser/fixtures/reader-interactions.html?work");
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(() => window.readerInteractions.saveHighlight("section-01-p1"));
  await expect(page.locator(".archeion-highlight")).toHaveCount(1);
  const initial = await page.evaluate(() => window.readerInteractions.work()!);
  const visited = new Set<string>();
  const samples = [];
  for (let step = 0; step < 100; step++) {
    const sample = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(".epub-container")!;
      const viewport = scroller.getBoundingClientRect();
      return {
        visible: [...scroller.querySelectorAll("iframe")]
          .filter((frame) => {
            const box = frame.getBoundingClientRect();
            return (
              box.bottom > viewport.top &&
              box.top < viewport.bottom &&
              getComputedStyle(frame).visibility === "visible"
            );
          })
          .map((frame) => frame.contentDocument!.title),
        work: window.readerInteractions.work()!,
        relocations: window.readerInteractions.relocations(),
      };
    });
    sample.visible.forEach((section) => visited.add(section));
    samples.push(sample);
    if (visited.size >= 22) break;
    const box = await page.locator(".epub-container").boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 200);
    await page.mouse.wheel(0, 600);
    await page.evaluate(async () => {
      for (let frame = 0; frame < 20; frame++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
  expect(visited.size).toBeGreaterThanOrEqual(22);
  const traversed = await page.evaluate(() => window.readerInteractions.work()!);
  const baseline = Boolean(process.env.ARCHEION_READER_WORK_BASELINE);
  await testInfo.attach("work-traversal", {
    body: JSON.stringify({ baseline, visited: [...visited], initial, traversed, samples }),
    contentType: "application/json",
  });
  if (!baseline) {
    expect(traversed.reconciliations).toBe(initial.reconciliations);
    expect(traversed.documents.every((doc) => doc.proseClassifications === 1)).toBe(true);
    expect(traversed.documents.every((doc) => doc.preparations === 1)).toBe(true);
    // Initial measured stage attachment may require one geometry invalidation.
    expect(
      Math.max(...traversed.documents.map((doc) => doc.mediaClassifications)),
    ).toBeLessThanOrEqual(2);
  }
  for (let repeat = 0; repeat < 10; repeat++)
    await page.evaluate(() => window.readerInteractions.settings({}));
  const unchanged = await page.evaluate(() => window.readerInteractions.work()!);
  if (!baseline) expect(unchanged.documents).toEqual(traversed.documents);
  await page.evaluate(() => window.readerInteractions.settings({ fontSize: 24 }));
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.readerInteractions
          .work()!
          .documents.reduce((total, doc) => total + doc.mediaClassifications, 0),
      ),
    )
    .toBeGreaterThan(
      traversed.documents.reduce((total, doc) => total + doc.mediaClassifications, 0),
    );
  await page.evaluate(() => window.readerInteractions.navigate("section-01"));
  await expect(page.locator(".archeion-highlight")).toHaveCount(1);
  const cfi = await page.evaluate(() => window.readerInteractions.location());
  expect(cfi).toBeTruthy();
  await page.evaluate(() => window.readerInteractions.open("nested-prose", "paged", "archive-b"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  const switched = await page.evaluate(() => window.readerInteractions.persistence());
  expect(
    switched.writes.filter((write) => write.bookId.includes("long-spine")).at(-1)?.changes
      .progressCfi,
  ).toBe(cfi);
  expect(switched.flushes).toBe(1);
  const finalCfi = await page.evaluate(() => window.readerInteractions.location());
  await page.evaluate(() => window.readerInteractions.dispose());
  const final = await page.evaluate(() => ({
    work: window.readerInteractions.work()!,
    persistence: window.readerInteractions.persistence(),
    listeners: window.readerInteractions.metrics(),
  }));
  expect(final.persistence.writes.at(-1)?.changes.progressCfi).toBe(finalCfi);
  expect(final.persistence.flushes).toBe(2);
  expect(final.work.observedLivingDocuments).toBe(0);
  expect(final.listeners.listeners).toBe(0);
  await testInfo.attach("work-final", {
    body: JSON.stringify({ unchanged, final }),
    contentType: "application/json",
  });
});
