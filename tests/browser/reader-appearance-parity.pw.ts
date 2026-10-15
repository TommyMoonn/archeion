import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const sample = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(".epub-container")!;
          return JSON.stringify([
            scroller.scrollTop,
            scroller.scrollLeft,
            scroller.scrollHeight,
            scroller.scrollWidth,
            window.readerInteractions.location(),
            [...scroller.querySelectorAll("iframe")].map((frame) =>
              frame.getBoundingClientRect().toJSON(),
            ),
          ]);
        });
        stable = sample === previous ? stable + 1 : 0;
        previous = sample;
        return stable;
      },
      { intervals: [100], timeout: 8000 },
    )
    .toBeGreaterThanOrEqual(3);
}

async function appearanceGeometry(page: Page, cfi: string) {
  return page.evaluate((target) => {
    const scroller = document.querySelector<HTMLElement>(".epub-container")!;
    return {
      original: window.readerInteractions.passageAt(target),
      current: window.readerInteractions.location(),
      viewport: scroller.getBoundingClientRect().toJSON(),
      scrollTop: scroller.scrollTop,
      scrollMaximum: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      documents: [...scroller.querySelectorAll("iframe")].map((frame) => ({
        title: frame.contentDocument?.title,
        frame: frame.getBoundingClientRect().toJSON(),
        body: frame.contentDocument?.body.getBoundingClientRect().toJSON(),
        fonts: frame.contentDocument?.fonts.status,
        layout: frame.contentDocument?.getElementById("archeion-reader-reflowable-layout")?.dataset,
      })),
      listeners: window.readerInteractions.metrics(),
    };
  }, cfi);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
});

for (const mode of ["continuous", "paged"] as const) {
  for (const section of ["section-01", "section-21", "section-42"]) {
    test(`${mode} appearance matrix at ${section}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.evaluate((flow) => window.readerInteractions.open("long-spine", flow), mode);
      await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
      await page.evaluate((target) => window.readerInteractions.navigate(target), section);
      await settle(page);
      const anchor = await page.evaluate(
        (flow) =>
          flow === "continuous"
            ? window.readerInteractions.passage().cfi
            : window.readerInteractions.location()!,
        mode,
      );
      expect(
        await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, anchor),
      ).toBe(true);
      const before = await appearanceGeometry(page, anchor);
      const samples = [];
      const colors = new Map<string, string>();
      for (const width of ["narrow", "comfortable", "wide", "full"] as const) {
        for (const palette of ["light", "dark", "sepia"] as const) {
          for (const font of ["serif", "literata"] as const) {
            for (const presentation of ["publisher", "archeion"] as const) {
              await page.evaluate(
                ({ width, palette, font, presentation }) => {
                  window.readerInteractions.settings({
                    readingWidth: width,
                    fontFamily: { kind: "builtin", id: font },
                  });
                  window.readerInteractions.palette(palette);
                  window.readerInteractions.presentation(presentation);
                },
                { width, palette, font, presentation },
              );
              await settle(page);
              const after = await appearanceGeometry(page, anchor);
              if (!after.original?.visible) {
                await testInfo.attach("visible-cfi-failure", {
                  body: JSON.stringify({
                    before,
                    width,
                    palette,
                    font,
                    presentation,
                    anchor,
                    after,
                  }),
                  contentType: "application/json",
                });
              }
              expect(
                after.original?.visible,
                JSON.stringify({ width, palette, font, presentation, anchor, after }),
              ).toBe(true);
              const documents = await page.evaluate(() =>
                [...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe")].map(
                  (frame) => {
                    const doc = frame.contentDocument!;
                    const text = doc.defaultView!.getComputedStyle(doc.querySelector("p")!);
                    return {
                      title: doc.title,
                      fontFamily: text.fontFamily,
                      fontSize: text.fontSize,
                      color: text.color,
                      prose: doc.querySelectorAll(
                        "[data-archeion-running-prose], [data-archeion-prose-continuation], [data-archeion-prose-flow]",
                      ).length,
                      themeSheets: doc.querySelectorAll("#epubjs-inserted-css-archeion-reader")
                        .length,
                      layoutSheets: doc.querySelectorAll("#archeion-reader-reflowable-layout")
                        .length,
                    };
                  },
                ),
              );
              for (const doc of documents) {
                expect(doc.fontSize).toBe("18px");
                expect(doc.fontFamily.includes("Literata")).toBe(font === "literata");
                if (colors.has(palette)) expect(doc.color).toBe(colors.get(palette));
                else colors.set(palette, doc.color);
                expect(doc.themeSheets).toBe(1);
                expect(doc.layoutSheets).toBe(presentation === "archeion" ? 1 : 0);
                if (presentation === "publisher") expect(doc.prose).toBe(0);
                else expect(doc.prose).toBeGreaterThan(0);
              }
              samples.push({ width, palette, font, presentation, documents, geometry: after });
            }
          }
        }
      }
      expect(new Set(colors.values()).size).toBe(3);
      expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("appearance.png") });
      await testInfo.attach("appearance-matrix", {
        body: JSON.stringify({ anchor, before, samples }),
        contentType: "application/json",
      });
    });
  }
}

test("nested highlight, search and footnote survive appearance, mode replacement and eviction", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const highlight = await page.evaluate(() =>
    window.readerInteractions.saveHighlight("section-01-p1"),
  );
  await page.evaluate(() => window.readerInteractions.search("Fixture section-01, passage 1."));
  await expect
    .poll(() => page.evaluate(() => window.readerInteractions.searchState().status))
    .toBe("ready");
  const result = await page.evaluate(() => window.readerInteractions.searchState().results[0]);
  await page.evaluate((id) => window.readerInteractions.followSearch(id), result.id);
  for (const mode of ["paged", "continuous"] as const) {
    await page.evaluate((flow) => {
      window.readerInteractions.presentation("publisher");
      window.readerInteractions.settings({ mode: flow, fontSize: 22, readingWidth: "narrow" });
    }, mode);
    await settle(page);
    expect(
      await page.evaluate(
        (cfi) => window.readerInteractions.passageAt(cfi)?.visible,
        highlight.cfiRange,
      ),
    ).toBe(true);
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await settle(page);
    const oldFrame = await page.locator("iframe").first().elementHandle();
    await page.evaluate(() => window.readerInteractions.navigate("section-42"));
    await settle(page);
    expect(await oldFrame!.evaluate((node) => node.isConnected)).toBe(false);
    await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), highlight.cfiRange);
    await settle(page);
    expect(await page.evaluate(() => window.readerInteractions.cfi("section-01-p1"))).toBe(
      highlight.cfiRange,
    );
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    await expect(page.locator(".archeion-search-match-emphasis")).toHaveCount(1);
    const painted = await page.locator(".archeion-highlight rect").last().boundingBox();
    expect(painted).not.toBeNull();
    await page.mouse.click(painted!.x + painted!.width / 2, painted!.y + painted!.height / 2);
    await expect(page.getByRole("menuitem", { name: "Edit note", exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: "Edit note", exact: true }).click();
    expect(await page.evaluate(() => window.readerInteractions.note())).toBe(highlight.id);
    const noteCfi = await page.evaluate(() => window.readerInteractions.cfi("long-note-link"));
    await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), noteCfi);
    await settle(page);
    let chapter;
    for (const frame of page.frames()) if ((await frame.title()) === "section-01") chapter = frame;
    expect(chapter).toBeDefined();
    const note = chapter!.locator("#long-note-link");
    // Only the current note-owning frame contains this target.
    await note.click();
    await expect(page.locator(".reader-footnote")).toContainText(
      "Original long-spine survey note.",
    );
    await page.keyboard.press("Escape");
    await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), highlight.cfiRange);
  }
});

for (const fixture of ["fixed-layout", "nested-prose"] as const) {
  test(`${fixture} structural controls survive appearance and mode transitions`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.evaluate((id) => window.readerInteractions.open(id), fixture);
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    await settle(page);
    const readControl = () =>
      page.evaluate((id) => {
        const doc =
          document.querySelector<HTMLIFrameElement>(".epub-container iframe")!.contentDocument!;
        const style = (selector: string) =>
          doc.defaultView!.getComputedStyle(doc.querySelector(selector)!);
        return id === "fixed-layout"
          ? {
              text: doc.body.textContent,
              font: style("#page-one-anchor").fontSize,
              width: style("body").width,
              height: style("body").height,
              art: [style(".page-art").width, style(".page-art").height],
              policy: doc.querySelectorAll(
                "[data-archeion-running-prose], [data-archeion-media-center], #archeion-reader-reflowable-layout, #epubjs-inserted-css-archeion-reader",
              ).length,
            }
          : {
              text: doc.body.textContent,
              poetry: style("#poem").whiteSpace,
              fixedWidth: style(".fixed-prose").width,
              columns: style(".columns-prose").columnCount,
              grid: style(".grid-prose").display,
              ruby: doc.querySelectorAll("ruby rt").length,
              protected: doc.querySelectorAll(
                "#stanza[data-archeion-running-prose], #quote[data-archeion-running-prose], #caption-paragraph[data-archeion-running-prose], #table-paragraph[data-archeion-running-prose], #fixed-prose[data-archeion-running-prose]",
              ).length,
              centeredFigure: doc.querySelectorAll("figure [data-archeion-media-center]").length,
            };
      }, fixture);
    const before = await readControl();
    for (const mode of ["paged", "continuous"] as const) {
      for (const width of ["narrow", "comfortable", "wide", "full"] as const) {
        for (const palette of ["light", "dark", "sepia"] as const) {
          for (const presentation of ["publisher", "archeion"] as const) {
            await page.evaluate(
              ({ mode, width, palette, presentation }) => {
                window.readerInteractions.settings({
                  mode,
                  readingWidth: width,
                  fontSize: 24,
                  fontFamily: { kind: "builtin", id: "literata" },
                });
                window.readerInteractions.palette(palette);
                window.readerInteractions.presentation(presentation);
              },
              { mode, width, palette, presentation },
            );
            await settle(page);
            expect(await readControl()).toEqual(before);
          }
        }
      }
    }
    await page.screenshot({ path: testInfo.outputPath("structural-control.png") });
    if (fixture === "fixed-layout") {
      await page
        .frameLocator(".epub-container iframe")
        .getByRole("link", { name: "Continue to page two" })
        .click();
      await expect(
        page.frameLocator(".epub-container iframe").locator("#page-two-anchor"),
      ).toBeVisible();
    }
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  });
}

test("book and archive replacement resolve the new policy before preparing content", async ({
  page,
}) => {
  for (const [archive, presentation] of [
    ["archive-a", "publisher"],
    ["archive-b", "archeion"],
    ["archive-b", "publisher"],
  ] as const) {
    await page.evaluate(
      ({ archive, presentation }) =>
        window.readerInteractions.open("nested-prose", "continuous", archive, presentation),
      { archive, presentation },
    );
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    await settle(page);
    const prose = page.frameLocator(".epub-container iframe").locator("#nested-anchor");
    expect(await prose.evaluate((node) => getComputedStyle(node).textIndent)).toBe(
      presentation === "publisher" ? "27px" : "0px",
    );
  }
});
