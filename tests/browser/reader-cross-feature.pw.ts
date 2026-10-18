import { expect, test, type Page } from "@playwright/test";

async function settled(page: Page) {
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => {
          const stage = document.querySelector<HTMLElement>(".epub-container")!;
          return JSON.stringify([
            stage.scrollTop,
            stage.scrollLeft,
            stage.scrollHeight,
            window.readerInteractions.location(),
            [...stage.querySelectorAll("iframe")].map((frame) => frame.getBoundingClientRect()),
          ]);
        });
        stable = current === previous ? stable + 1 : 0;
        previous = current;
        return stable;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
}

for (const mode of ["continuous", "paged"] as const) {
  test(`${mode}: history and search restore evicted passages after appearance changes`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/tests/browser/fixtures/reader-interactions.html?work");
    await settled(page);
    await page.evaluate((flow) => window.readerInteractions.open("long-spine", flow), mode);
    await settled(page);
    const highlight = await page.evaluate(() =>
      window.readerInteractions.saveHighlight("section-01-p1"),
    );
    await page.evaluate(() => window.readerInteractions.search("Fixture section-01, passage"));
    await expect
      .poll(() => page.evaluate(() => window.readerInteractions.searchState().status))
      .toBe("ready");
    const results = await page.evaluate(() => window.readerInteractions.searchState().results);
    expect(results.length).toBeGreaterThan(1);
    expect(
      await page.evaluate((id) => window.readerInteractions.followSearch(id), results[0].id),
    ).toBe(true);
    await settled(page);
    const firstCfi = await page.evaluate(() => window.readerInteractions.location()!);
    const oldFrame = await page.locator("iframe").first().elementHandle();
    expect(await page.evaluate(() => window.readerInteractions.navigate("section-42"))).toBe(true);
    await settled(page);
    expect(await oldFrame!.evaluate((frame) => frame.isConnected)).toBe(false);
    const lastCfi = await page.evaluate(() => window.readerInteractions.location()!);
    await page.evaluate(() => {
      window.readerInteractions.palette("sepia");
      window.readerInteractions.presentation("publisher");
      window.readerInteractions.settings({ fontSize: 24, readingWidth: "narrow" });
    });
    await settled(page);
    expect(await page.evaluate(() => window.readerInteractions.back())).toBe(true);
    await settled(page);
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, firstCfi),
    ).toBe(true);
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    await expect(page.locator(".archeion-search-match-emphasis")).toHaveCount(1);
    expect(await page.evaluate(() => window.readerInteractions.cfi("section-01-p1"))).toBe(
      highlight.cfiRange,
    );
    expect(await page.evaluate(() => window.readerInteractions.forward())).toBe(true);
    await settled(page);
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, lastCfi),
    ).toBe(true);
    expect(await page.evaluate(() => window.readerInteractions.nextSearch())).toBe(true);
    await settled(page);
    expect(
      await page.evaluate(() => window.readerInteractions.searchState().selectedResult?.id),
    ).toBe(results[1].id);
    await expect(page.locator(".archeion-search-match-emphasis")).toHaveCount(1);
    expect(await page.evaluate(() => window.readerInteractions.previousSearch())).toBe(true);
    await settled(page);
    expect(
      await page.evaluate(() => window.readerInteractions.searchState().selectedResult?.id),
    ).toBe(results[0].id);
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
    await page.evaluate(() => window.readerInteractions.dispose());
    expect((await page.evaluate(() => window.readerInteractions.metrics())).listeners).toBe(0);
  });

  test(`${mode}: final progress resumes on repeated reopen without retired listeners`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto("/tests/browser/fixtures/reader-interactions.html?work");
    await settled(page);
    await page.evaluate((flow) => window.readerInteractions.open("long-spine", flow), mode);
    await settled(page);
    const samples = [];
    const baseline = await page.evaluate(() => window.readerInteractions.metrics());
    const listenersPerDocument = baseline.listeners / baseline.livingDocuments;
    const bookId = await page.evaluate(() => window.readerInteractions.persistence().bookId);
    for (const section of ["section-21", "section-42", "section-01"]) {
      expect(
        await page.evaluate((target) => window.readerInteractions.navigate(target), section),
      ).toBe(true);
      await settled(page);
      const cfi = await page.evaluate(() => window.readerInteractions.location()!);
      const before = await page.evaluate(() => window.readerInteractions.persistence());
      // Controlled exit must drain the final CFI before the same book is reopened.
      await page.evaluate(() => window.readerInteractions.dispose());
      const closed = await page.evaluate(() => ({
        persistence: window.readerInteractions.persistence(),
        listeners: window.readerInteractions.metrics(),
      }));
      expect(closed.persistence.writes.at(-1)?.changes.progressCfi).toBe(cfi);
      expect(closed.persistence.bookId).toBe(bookId);
      expect(closed.persistence.saved[bookId]?.progressCfi).toBe(cfi);
      expect(closed.persistence.flushes).toBe(before.flushes + 1);
      expect(closed.listeners.listeners).toBe(0);
      expect(closed.listeners.mountedFrames).toBe(0);
      await page.evaluate(
        (flow) => window.readerInteractions.open("long-spine", flow, "archive-a"),
        mode,
      );
      await settled(page);
      expect(await page.evaluate(() => window.readerInteractions.persistence().bookId)).toBe(
        bookId,
      );
      expect(
        await page.evaluate((target) => window.readerInteractions.passageAt(target)?.visible, cfi),
      ).toBe(true);
      const metrics = await page.evaluate(() => window.readerInteractions.metrics());
      expect(metrics.retiredListeners).toBe(0);
      expect(metrics.listeners).toBe(metrics.livingDocuments * listenersPerDocument);
      samples.push({ section, cfi, metrics });
    }
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
    await page.evaluate(() => window.readerInteractions.dispose());
    expect((await page.evaluate(() => window.readerInteractions.metrics())).listeners).toBe(0);
    await testInfo.attach("reopen-progress", {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
  });
}
