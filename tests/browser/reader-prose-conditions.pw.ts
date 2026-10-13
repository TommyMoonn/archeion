import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, mode: "continuous" | "paged", width = 1050) {
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.locator("#root").evaluate((root, width) => {
    root.style.width = `${width}px`;
  }, width);
  await page.evaluate((mode) => window.readerInteractions.open("conditional-prose", mode), mode);
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

for (const mode of ["continuous", "paged"] as const) {
  test(`inactive conditions normalize actual EPUB prose in ${mode}`, async ({ page }, testInfo) => {
    await open(page, mode);
    const frame = page.frameLocator(".epub-container iframe");
    const samples = [];
    for (const fontSize of [16, 18, 20]) {
      await page.evaluate((fontSize) => window.readerInteractions.settings({ fontSize }), fontSize);
      for (const prefix of ["unreachable", "print", "unsupported"]) {
        const first = frame.locator(`#${prefix}-first`);
        await expect
          .poll(() => first.evaluate((p) => getComputedStyle(p).fontSize))
          .toBe(`${fontSize}px`);
        const sample = await first.evaluate((p) => {
          const box = p.getBoundingClientRect();
          const next = p.nextElementSibling!.getBoundingClientRect();
          const body = p.ownerDocument.body.getBoundingClientRect();
          const style = getComputedStyle(p.ownerDocument.body);
          const gap = parseFloat(style.columnGap);
          const pitch = Number.isFinite(gap)
            ? body.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + gap
            : body.width;
          const column = Number.isFinite(gap) ? Math.floor((box.left - body.left) / pitch) : 0;
          return {
            indent: getComputedStyle(p).textIndent,
            gap: next.top - box.bottom,
            centerError: box.left + box.width / 2 - (body.left + column * pitch + body.width / 2),
            classified: p.hasAttribute("data-archeion-running-prose"),
          };
        });
        expect(sample.indent).toBe("0px");
        expect(sample.gap).toBeCloseTo(fontSize / 2, 1);
        expect(Math.abs(sample.centerError)).toBeLessThanOrEqual(2);
        expect(sample.classified).toBe(true);
        samples.push({ fontSize, prefix, ...sample });
      }
    }
    await testInfo.attach("inactive-conditional-geometry", {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
  });

  test(`active conditional dimensions stay protected through responsive transitions in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    const first = page.frameLocator(".epub-container iframe").locator("#responsive-first");
    const samples = [];
    for (const width of [1050, 700, 1050, 700]) {
      await page.locator("#root").evaluate((root, width) => {
        root.style.width = `${width}px`;
      }, width);
      const active = width >= 800;
      await expect
        .poll(() =>
          first.evaluate(
            (p) => p.ownerDocument.defaultView!.matchMedia("(min-width: 800px)").matches,
          ),
        )
        .toBe(active);
      await expect
        .poll(() => first.evaluate((p) => getComputedStyle(p).textIndent))
        .toBe(active ? "36px" : "0px");
      const sample = await first.evaluate((p) => ({
        gap: p.nextElementSibling!.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
        width: p.closest("article")!.getBoundingClientRect().width,
        classified: p.hasAttribute("data-archeion-running-prose"),
      }));
      expect(sample.classified).toBe(!active);
      expect(sample.gap).toBeCloseTo(active ? 0 : 9, 1);
      if (active) expect(sample.width).toBeCloseTo(432, 1);
      samples.push({ stageWidth: width, active, ...sample });
    }
    await testInfo.attach("conditional-breakpoint-transitions", {
      body: JSON.stringify(samples),
      contentType: "application/json",
    });
  });

  test(`print applicability refreshes a retained EPUB iframe during typography reflow in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    const first = page.frameLocator(".epub-container iframe").locator("#print-first");
    await first.evaluate((p) => {
      p.ownerDocument.documentElement.dataset.conditionalProbe = "retained";
    });
    const highlight = await page.evaluate(() =>
      window.readerInteractions.saveHighlight("print-second"),
    );
    const samples = [];
    for (const media of ["print", "screen"] as const) {
      const fontSize = media === "print" ? 20 : 18;
      await page.emulateMedia({ media });
      await page.evaluate((fontSize) => window.readerInteractions.settings({ fontSize }), fontSize);
      await expect
        .poll(() => first.evaluate((p) => getComputedStyle(p).textIndent))
        .toBe(media === "print" ? "40px" : "0px");
      const sample = await first.evaluate((p) => ({
        retained: p.ownerDocument.documentElement.dataset.conditionalProbe,
        classified: p.hasAttribute("data-archeion-running-prose"),
        gap: p.nextElementSibling!.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
        width: p.closest("article")!.getBoundingClientRect().width,
        font: getComputedStyle(p).fontSize,
        color: getComputedStyle(p).color,
      }));
      expect(sample.retained).toBe("retained");
      expect(sample.classified).toBe(media === "screen");
      expect(sample.gap).toBeCloseTo(media === "print" ? 0 : 9, 1);
      if (media === "print") expect(sample.width).toBeCloseTo(480, 1);
      expect(await page.evaluate(() => window.readerInteractions.cfi("print-second"))).toBe(
        highlight.cfiRange,
      );
      await expect(page.locator(".epub-viewer .archeion-highlight")).toHaveCount(1);
      samples.push({ media, ...sample });
    }
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await expect.poll(() => first.evaluate((p) => getComputedStyle(p).textIndent)).toBe("36px");
    const publisher = await first.evaluate((p) => ({
      gap: p.nextElementSibling!.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
      margin: getComputedStyle(p.closest("article")!).marginLeft,
      font: getComputedStyle(p).fontSize,
      color: getComputedStyle(p).color,
    }));
    expect(publisher.gap).toBe(0);
    expect(publisher.margin).toBe("42px");
    expect(publisher.font).toBe(samples[1].font);
    expect(publisher.color).toBe(samples[1].color);
    await testInfo.attach("retained-conditional-iframe", {
      body: JSON.stringify({ samples, publisher }),
      contentType: "application/json",
    });
  });
}
