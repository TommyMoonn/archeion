import { expect, test } from "@playwright/test";

for (const retirement of ["mode", "book", "exit"] as const) {
  test(`a seek-map section response may finish after ${retirement} retirement without an unhandled rejection`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/browser/fixtures/reader-interactions.html?sectionLoads");
    await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.readerInteractions.sectionLoads!.waiting()))
      .toBe(true);
    const frame = await page.locator(".epub-viewer iframe").first().elementHandle();
    if (retirement === "mode") {
      await page.evaluate(() => window.readerInteractions.settings({ mode: "paged" }));
      await expect(page.locator(".epub-viewer")).toHaveAttribute("data-reader-mode", "paged");
      await expect(page.locator(".reader-loading")).toHaveCount(0);
    } else if (retirement === "book") {
      await page.evaluate(() =>
        window.readerInteractions.open("nested-prose", "continuous", "archive-b"),
      );
      await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
      await expect(
        page.frameLocator(".epub-viewer iframe").locator("#nested-anchor"),
      ).toBeVisible();
    } else {
      await page.evaluate(() => window.readerInteractions.dispose());
      await expect(page.locator(".epub-viewer iframe")).toHaveCount(0);
    }
    expect(await frame!.evaluate((element) => element.isConnected)).toBe(false);
    const beforeRelease = await page.evaluate(() =>
      window.readerInteractions.sectionLoads!.snapshot(),
    );
    await page.evaluate(() => window.readerInteractions.sectionLoads!.release());
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(() => page.evaluate(() => window.readerInteractions.sectionLoads!.snapshot().destroyed))
      .toBe(true);
    const afterRelease = await page.evaluate(() =>
      window.readerInteractions.sectionLoads!.snapshot(),
    );
    await testInfo.attach("seek-generation-retirement", {
      body: JSON.stringify({ beforeRelease, afterRelease, errors }),
      contentType: "application/json",
    });
    expect(beforeRelease.events).toContainEqual({
      kind: "generation",
      caller: "ReaderSeekMap.generate",
    });
    expect(beforeRelease.destroyed).toBe(false);
    expect(
      afterRelease.events.findIndex((event) => event.kind === "response-released"),
    ).toBeLessThan(afterRelease.events.findIndex((event) => event.kind === "book-destroyed"));
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
    await page.evaluate(() => window.readerInteractions.dispose());
    expect((await page.evaluate(() => window.readerInteractions.metrics())).listeners).toBe(0);
    await page.evaluate(() => window.readerInteractions.sectionLoads!.dispose());
  });
}
