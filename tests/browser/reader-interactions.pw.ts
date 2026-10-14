import { expect, test, type Page } from "@playwright/test";

async function openSurface(page: Page) {
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
}
async function chapter(page: Page, title: string) {
  for (const frame of page.frames()) if ((await frame.title()) === title) return frame;
  throw new Error(`Synthetic chapter not mounted: ${title}`);
}
async function navigate(page: Page, section: string) {
  expect(
    await page.evaluate((target) => window.readerInteractions.navigate(target), section),
    section,
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.readerInteractions.metrics().retiredListeners))
    .toBe(0);
}
async function selectPassage(page: Page, title: string, id: string) {
  const frame = await chapter(page, title);
  await frame.locator(`#${id}`).evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection = element.ownerDocument.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(page.getByRole("menu", { name: "Highlight color" })).toBeVisible();
  return frame;
}

async function settlePassage(page: Page) {
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const signature = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(".epub-container")!;
          return JSON.stringify([
            scroller.scrollTop,
            scroller.scrollHeight,
            [...document.querySelectorAll(".archeion-highlight rect")].map((element) =>
              element.getBoundingClientRect().toJSON(),
            ),
          ]);
        });
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        return stable;
      },
      { intervals: [100] },
    )
    .toBeGreaterThanOrEqual(4);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

test("annotations, bookmark CFIs, search emphasis and event hooks survive 42 section transitions and remounts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await openSurface(page);
  const highlight = await page.evaluate(() =>
    window.readerInteractions.saveHighlight("section-01-p1"),
  );
  const bookmark = await page.evaluate(() =>
    window.readerInteractions.bookmark("section-01-anchor"),
  );
  await expect(page.locator(".archeion-highlight")).toHaveCount(1);
  await page.evaluate(() => window.readerInteractions.search("Fixture section-01, passage 1."));
  await expect
    .poll(() => page.evaluate(() => window.readerInteractions.searchState().status))
    .toBe("ready");
  const result = await page.evaluate(() => window.readerInteractions.searchState().results[0]);
  expect(result).toBeDefined();
  expect(await page.evaluate((id) => window.readerInteractions.followSearch(id), result.id)).toBe(
    true,
  );
  await expect(page.locator(".archeion-search-match-emphasis")).toHaveCount(1);
  const oldDocument = await page.evaluateHandle(
    () =>
      [...document.querySelectorAll<HTMLIFrameElement>(".epub-viewer iframe")].find(
        (frame) => frame.contentDocument?.title === "section-01",
      )!.contentDocument!,
  );
  const samples = [];
  for (let index = 2; index <= 42; index++) {
    await navigate(page, `section-${String(index).padStart(2, "0")}`);
    let metrics = await page.evaluate(() => window.readerInteractions.metrics());
    await expect
      .poll(async () => {
        metrics = await page.evaluate(() => window.readerInteractions.metrics());
        return metrics.livingDocuments === metrics.mountedFrames && metrics.retiredListeners === 0;
      })
      .toBe(true);
    // Five interaction callbacks plus one shared load/error media-readiness callback.
    expect(metrics.listeners).toBe(metrics.livingDocuments * 6);
    expect(metrics.livingDocuments).toBe(metrics.mountedFrames);
    samples.push(metrics);
  }
  expect(
    await oldDocument.evaluate((doc) => Boolean(doc.defaultView?.frameElement?.isConnected)),
  ).toBe(false);
  const keysBefore = await page.evaluate(() => window.readerInteractions.keys());
  await oldDocument.evaluate((doc) =>
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "F8", bubbles: true })),
  );
  expect(await page.evaluate(() => window.readerInteractions.keys())).toBe(keysBefore);
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(
      await page.evaluate((saved) => window.readerInteractions.followBookmark(saved), bookmark),
    ).toBe(true);
    const remounted = await chapter(page, "section-01");
    expect(
      await remounted.locator("#section-01-p1").evaluate((element) => element.textContent),
    ).toBe(highlight.selectedText);
    expect(await page.evaluate(() => window.readerInteractions.cfi("section-01-p1"))).toBe(
      highlight.cfiRange,
    );
    expect(await page.evaluate(() => window.readerInteractions.cfi("section-01-anchor"))).toBe(
      bookmark.cfiRange,
    );
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    await expect(page.locator(".archeion-search-match-emphasis")).toHaveCount(1);
    await page.evaluate((target) => window.readerInteractions.navigate(target), highlight.cfiRange);
    await settlePassage(page);
    // Click a painted highlight fragment beyond the shorter search underline.
    // epub.js proxies real iframe input to its pointer-transparent SVG marks.
    const painted = await page.locator(".archeion-highlight rect").last().boundingBox();
    expect(painted).not.toBeNull();
    await page.mouse.click(painted!.x + painted!.width / 2, painted!.y + painted!.height / 2);
    await expect(page.getByRole("menuitem", { name: "Edit note", exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: "Edit note", exact: true }).click();
    expect(await page.evaluate(() => window.readerInteractions.note())).toBe(highlight.id);
    await remounted.locator("body").evaluate((body) => {
      body.tabIndex = -1;
      body.focus();
    });
    await page.keyboard.press("F8");
    expect(await page.evaluate(() => window.readerInteractions.keys())).toBe(
      keysBefore + repeat + 1,
    );
    await navigate(page, "section-42");
  }
  expect(
    await page.evaluate((saved) => window.readerInteractions.followBookmark(saved), bookmark),
  ).toBe(true);
  await settlePassage(page);
  await selectPassage(page, "section-01", "section-01-p1");
  await page.evaluate(() => window.readerInteractions.holdDictionary());
  await page.getByRole("menuitem", { name: "Define", exact: true }).click();
  await expect(page.locator(".reader-dictionary-popover")).toBeVisible();
  await navigate(page, "section-42");
  await page.evaluate(() => window.readerInteractions.finishDictionary());
  await expect(page.locator(".reader-dictionary-popover")).toHaveCount(0);
  await navigate(page, "section-01");
  const noteTarget = await page.evaluate(() => window.readerInteractions.cfi("long-note-link"));
  await navigate(page, noteTarget);
  await settlePassage(page);
  await (await chapter(page, "section-01")).locator("#long-note-link").click();
  await expect(page.locator(".reader-footnote")).toBeVisible();
  await expect(page.locator(".reader-footnote")).toContainText("Original long-spine survey note.");
  await navigate(page, "section-21");
  await expect(page.locator(".reader-footnote")).toHaveCount(0);
  const illustration = (await chapter(page, "section-21")).locator("#long-media");
  await illustration.scrollIntoViewIfNeeded();
  await settlePassage(page);
  await illustration.focus();
  await illustration.press("Enter");
  await expect(page.locator(".reader-illustration-viewer")).toBeVisible();
  await navigate(page, "section-42");
  await expect(page.locator(".reader-illustration-viewer")).toHaveCount(0);
  expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  await page.evaluate(() => window.readerInteractions.dispose());
  await expect(page.locator(".epub-viewer iframe")).toHaveCount(0);
  expect((await page.evaluate(() => window.readerInteractions.metrics())).listeners).toBe(0);
  await testInfo.attach("listener-remount-evidence", {
    body: JSON.stringify({ highlight, bookmark, result, samples }),
    contentType: "application/json",
  });
});

test("selection, dictionary and illustration transients retire on eviction and book or archive replacement", async ({
  page,
}) => {
  await openSurface(page);
  await selectPassage(page, "section-01", "section-01-p1");
  await page.evaluate(() => window.readerInteractions.holdDictionary());
  await page.getByRole("menuitem", { name: "Define", exact: true }).click();
  await expect(page.locator(".reader-dictionary-popover")).toBeVisible();
  await page.evaluate(() =>
    window.readerInteractions.open("image-only", "continuous", "archive-b"),
  );
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(() => window.readerInteractions.finishDictionary());
  await expect(page.locator(".reader-dictionary-popover")).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "Highlight color" })).toHaveCount(0);
  const imageFrame = await chapter(page, "isolated");
  await imageFrame.locator("#isolated-image").focus();
  await imageFrame.locator("#isolated-image").press("Enter");
  await expect(page.locator(".reader-illustration-viewer")).toBeVisible();
  await page.evaluate(() => window.readerInteractions.open("nested-prose", "paged"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await expect(page.locator(".reader-illustration-viewer")).toHaveCount(0);
  const nested = await chapter(page, "nested");
  await nested.locator("#note-link").click();
  await expect(page.locator(".reader-footnote")).toBeVisible();
  await page.evaluate(() => window.readerInteractions.open("long-spine"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await expect(page.locator(".reader-footnote")).toHaveCount(0);
  expect((await page.evaluate(() => window.readerInteractions.metrics())).retiredListeners).toBe(0);
  expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  await page.evaluate(() => window.readerInteractions.dispose());
  expect((await page.evaluate(() => window.readerInteractions.metrics())).listeners).toBe(0);
});
