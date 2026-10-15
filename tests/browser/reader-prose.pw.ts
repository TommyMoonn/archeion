import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, mode: "continuous" | "paged", publisher = false) {
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.evaluate(
    ({ mode, publisher }) =>
      window.readerInteractions.open(
        "nested-prose",
        mode,
        "prose",
        publisher ? "publisher" : "archeion",
      ),
    { mode, publisher },
  );
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

for (const mode of ["continuous", "paged"] as const) {
  test(`half-em rhythm and centered nested prose in ${mode}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await open(page, mode);
    await page.locator("#root").evaluate((root) => {
      root.style.width = "1400px";
    });
    const paragraph = page.frameLocator(".epub-container iframe").locator("#nested-anchor");
    const samples = [];
    for (const fontSize of [16, 18, 20]) {
      await page.evaluate((fontSize) => window.readerInteractions.settings({ fontSize }), fontSize);
      await expect
        .poll(() => paragraph.evaluate((p) => getComputedStyle(p).fontSize))
        .toBe(`${fontSize}px`);
      for (const readingWidth of ["narrow", "comfortable", "wide", "full"] as const) {
        await page.evaluate(
          (readingWidth) => window.readerInteractions.settings({ readingWidth }),
          readingWidth,
        );
        await expect
          .poll(() =>
            paragraph.evaluate(
              (p) =>
                p.ownerDocument.getElementById("archeion-reader-reflowable-layout")?.dataset
                  .readerWidth,
            ),
          )
          .toBe(readingWidth);
        const sample = await paragraph.evaluate((p) => {
          const next = p.ownerDocument.getElementById("dialogue")!;
          const box = p.getBoundingClientRect();
          const computed = getComputedStyle(p);
          const body = p.ownerDocument.body.getBoundingClientRect();
          const heading = p.previousElementSibling!;
          return {
            indent: computed.textIndent,
            gap: next.getBoundingClientRect().top - box.bottom,
            nextMargin: getComputedStyle(next).marginBlockStart,
            centerError: box.left + box.width / 2 - (body.left + body.width / 2),
            width: box.width,
            headingGap: box.top - heading.getBoundingClientRect().bottom,
            headingMargin: parseFloat(getComputedStyle(heading).marginBlockEnd),
          };
        });
        expect(sample.indent).toBe("0px");
        expect(sample.gap).toBeCloseTo(fontSize / 2, 1);
        expect(sample.nextMargin).toBe(`${fontSize / 2}px`);
        expect(Math.abs(sample.centerError)).toBeLessThanOrEqual(2);
        expect(sample.headingGap).toBeCloseTo(sample.headingMargin, 1);
        samples.push({ fontSize, readingWidth, ...sample });
      }
    }
    for (const fontSize of [16, 18, 20]) {
      const widths = samples.filter((s) => s.fontSize === fontSize).map((s) => s.width);
      expect(widths[0]).toBeLessThan(widths[1]);
      expect(widths[1]).toBeLessThan(widths[2]);
      expect(widths[2]).toBeLessThan(widths[3]);
    }
    await testInfo.attach("prose-geometry", {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`${mode}-prose.png`) });
  });

  test(`structural typography and Publisher restoration in ${mode}`, async ({ page }, testInfo) => {
    await open(page, mode, true);
    const frame = page.frameLocator(".epub-container iframe");
    const anchor = frame.locator("#nested-anchor");
    const structural = async () =>
      anchor.evaluate((p) => {
        const document = p.ownerDocument;
        return [
          "stanza",
          "generic-footnote",
          "subtitle",
          "quote",
          "list-paragraph",
          "table-paragraph",
          "caption-paragraph",
          "epigraph",
          "fixed-prose",
          "float-prose",
          "columns-prose",
          "grid-prose",
          "empty-prose",
          "scene-break",
        ].map((id) => {
          const element = document.getElementById(id)!;
          const style = getComputedStyle(element);
          const parent = getComputedStyle(element.parentElement!);
          return {
            id,
            indent: style.textIndent,
            start: style.marginBlockStart,
            end: style.marginBlockEnd,
            whiteSpace: style.whiteSpace,
            parentWidth: id === "fixed-prose" ? parent.width : null,
            float: parent.float,
            columns: parent.columnCount,
            display: parent.display,
            classified: element.hasAttribute("data-archeion-running-prose"),
            text: element.textContent,
          };
        });
      });
    const before = await structural();
    const publisher = await anchor.evaluate((p) => ({
      indent: getComputedStyle(p).textIndent,
      gap:
        p.ownerDocument.getElementById("dialogue")!.getBoundingClientRect().top -
        p.getBoundingClientRect().bottom,
      wrapper: getComputedStyle(p.closest(".publisher-root")!).width,
      margin: getComputedStyle(p.closest(".publisher-root")!).marginLeft,
      font: getComputedStyle(p).fontSize,
      color: getComputedStyle(p).color,
    }));
    expect(publisher.indent).toBe("27px");
    expect(publisher.gap).toBe(0);
    expect(publisher.margin).toBe("42px");
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await expect.poll(() => anchor.evaluate((p) => getComputedStyle(p).textIndent)).toBe("0px");
    expect(await structural()).toEqual(before);
    const body = await frame.locator("#body-prose-first").evaluate((p) => {
      const next = p.nextElementSibling!;
      const box = p.getBoundingClientRect();
      const body = p.ownerDocument.body.getBoundingClientRect();
      const bodyStyle = getComputedStyle(p.ownerDocument.body);
      const contentWidth =
        body.width - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight);
      const columnGap = parseFloat(bodyStyle.columnGap);
      const pitch = Number.isFinite(columnGap) ? contentWidth + columnGap : body.width;
      const column = Number.isFinite(columnGap) ? Math.floor((box.left - body.left) / pitch) : 0;
      return {
        margin: getComputedStyle(p).marginBlockStart,
        gap: next.getBoundingClientRect().top - box.bottom,
        centerError: box.left + box.width / 2 - (body.left + column * pitch + body.width / 2),
        rtl: getComputedStyle(p.ownerDocument.getElementById("rtl")!).direction,
        ruby: p.ownerDocument.querySelector("#ruby ruby rt")?.textContent,
        justify: getComputedStyle(p.ownerDocument.getElementById("justified")!).textAlign,
        sceneMargin: getComputedStyle(p.ownerDocument.getElementById("scene-break")!)
          .marginBlockStart,
      };
    });
    expect(body.margin).toBe("0px");
    expect(body.gap).toBeCloseTo(9, 1);
    expect(Math.abs(body.centerError)).toBeLessThanOrEqual(2);
    expect(body.rtl).toBe("rtl");
    expect(body.ruby).toBe("みず");
    expect(body.justify).toBe("justify");
    expect(body.sceneMargin).toBe("36px");
    const wrapped = await frame.locator("#wrapped-first").evaluate((p) => {
      const next = p.ownerDocument.getElementById("wrapped-second")!;
      return {
        gap: next.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
        firstMargin: getComputedStyle(p).marginBlockStart,
        nextMargin: getComputedStyle(next).marginBlockStart,
      };
    });
    // The wrapper follows body prose without a heading or structural break.
    expect(wrapped.firstMargin).toBe("9px");
    expect(wrapped.nextMargin).toBe("9px");
    expect(wrapped.gap).toBeCloseTo(9, 1);
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await expect.poll(() => anchor.evaluate((p) => getComputedStyle(p).textIndent)).toBe("27px");
    expect(
      await anchor.evaluate((p) => ({
        indent: getComputedStyle(p).textIndent,
        gap:
          p.ownerDocument.getElementById("dialogue")!.getBoundingClientRect().top -
          p.getBoundingClientRect().bottom,
        wrapper: getComputedStyle(p.closest(".publisher-root")!).width,
        margin: getComputedStyle(p.closest(".publisher-root")!).marginLeft,
        font: getComputedStyle(p).fontSize,
        color: getComputedStyle(p).color,
      })),
    ).toEqual(publisher);
    expect(
      await anchor.evaluate(
        (p) =>
          p.ownerDocument.querySelectorAll(
            "[data-archeion-prose-flow], #archeion-reader-reflowable-layout",
          ).length,
      ),
    ).toBe(0);
    await testInfo.attach("structural-prose", {
      body: JSON.stringify({ before, publisher, body }),
      contentType: "application/json",
    });
  });

  test(`nested passage and highlight CFI survive font width and presentation changes in ${mode}`, async ({
    page,
  }) => {
    await open(page, mode);
    const highlight = await page.evaluate(() =>
      window.readerInteractions.saveHighlight("dialogue"),
    );
    await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), highlight.cfiRange);
    for (const change of ["font", "width", "publisher", "archeion"] as const) {
      await page.evaluate((change) => {
        if (change === "font")
          window.readerInteractions.settings({
            fontSize: 24,
            fontFamily: { kind: "builtin", id: "sans" },
          });
        else if (change === "width") window.readerInteractions.settings({ readingWidth: "narrow" });
        else window.readerInteractions.presentation(change);
      }, change);
      await expect
        .poll(() =>
          page.evaluate(
            (cfi) => window.readerInteractions.passageAt(cfi)?.visible,
            highlight.cfiRange,
          ),
        )
        .toBe(true);
      expect(await page.evaluate(() => window.readerInteractions.cfi("dialogue"))).toBe(
        highlight.cfiRange,
      );
      await expect(page.locator(".epub-viewer .archeion-highlight")).toHaveCount(1);
    }
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  });
}

test("large text and 200% layout zoom retain ordinary prose and visible link focus", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await open(page, "continuous");
  await page.locator("#root").evaluate((root) => {
    root.style.width = "320px";
    root.style.zoom = "2";
  });
  await page.evaluate(() =>
    window.readerInteractions.settings({ fontSize: 36, readingWidth: "full" }),
  );
  const paragraph = page.frameLocator(".epub-container iframe").locator("#nested-anchor");
  await expect.poll(() => paragraph.evaluate((p) => getComputedStyle(p).fontSize)).toBe("36px");
  await expect
    .poll(() =>
      paragraph.evaluate((p) => {
        const doc = p.ownerDocument;
        const box = p.getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.right <= doc.documentElement.clientWidth &&
          p.scrollWidth <= p.clientWidth
        );
      }),
    )
    .toBe(true);
  const link = page.frameLocator(".epub-container iframe").locator("#prose-focus-link");
  await link.focus();
  await expect(link).toBeFocused();
  expect(
    await link.evaluate((a) => {
      const style = getComputedStyle(a);
      return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    }),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("zoom-prose-focus.png") });
});
