import { expect, test, type Locator, type Page } from "@playwright/test";

async function open(page: Page, mode: "continuous" | "paged", width = 1050) {
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.locator("#root").evaluate((root, width) => {
    root.style.width = `${width}px`;
  }, width);
  await page.evaluate((mode) => window.readerInteractions.open("image-only", mode, "media"), mode);
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await settle(page);
}

async function settle(page: Page) {
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const signature = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(".epub-container")!;
          return JSON.stringify([
            window.readerInteractions.location(),
            scroller.scrollTop,
            scroller.scrollHeight,
            [...scroller.querySelectorAll<HTMLIFrameElement>("iframe")].map((frame) => {
              const doc = frame.contentDocument!;
              return [
                doc.title,
                frame.getBoundingClientRect().height,
                doc.getElementById("archeion-reader-reflowable-layout")?.dataset.readerWidth,
                [...doc.querySelectorAll("img, svg")].map((media) => {
                  const box = media.getBoundingClientRect();
                  return [box.left, box.top, box.width, box.height];
                }),
              ];
            }),
          ]);
        });
        stable = signature === previous ? stable + 1 : 0;
        previous = signature;
        return stable;
      },
      { timeout: 8000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(4);
}

async function geometry(media: Locator) {
  return media.evaluate((element) => {
    const doc = element.ownerDocument;
    const box = element.getBoundingClientRect();
    const body = doc.body.getBoundingClientRect();
    const style = getComputedStyle(doc.body);
    const contentWidth =
      body.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap);
    const pitch = Number.isFinite(gap) ? contentWidth + gap : body.width;
    const column = Number.isFinite(gap) ? Math.floor((box.left - body.left) / pitch) : 0;
    return {
      width: box.width,
      height: box.height,
      centerError: box.left + box.width / 2 - (body.left + column * pitch + body.width / 2),
      sourceWidth:
        element instanceof HTMLImageElement
          ? element.naturalWidth
          : Number(element.getAttribute("viewBox")!.split(" ")[2]),
      sourceHeight:
        element instanceof HTMLImageElement
          ? element.naturalHeight
          : Number(element.getAttribute("viewBox")!.split(" ")[3]),
      centered: element.hasAttribute("data-archeion-media-center"),
      bodyWidth: body.width,
    };
  });
}

function illustration(page: Page, section: string, id: string) {
  return page
    .frameLocator(`.epub-container iframe[srcdoc*="<title>${section}</title>"]`)
    .locator(`#${id}`);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

for (const mode of ["continuous", "paged"] as const) {
  test(`automatic publisher margin is not a positioned offset in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    expect(await page.evaluate(() => window.readerInteractions.navigate("auto-margin-art"))).toBe(
      true,
    );
    const media = illustration(page, "auto-margin-art", "auto-plate");
    const margin = await media.evaluate((el) => ({
      used: getComputedStyle(el).marginLeft,
      computed: el.computedStyleMap?.().get("margin-left")?.toString(),
    }));
    await testInfo.attach("publisher-auto-margin", {
      body: JSON.stringify(margin),
      contentType: "application/json",
    });
    expect(parseFloat(margin.used)).toBeGreaterThan(0);
    expect(margin.computed).toBe("auto");
    expect((await geometry(media)).centered).toBe(true);
    expect(Math.abs((await geometry(media)).centerError)).toBeLessThanOrEqual(1);
  });
  for (const width of [900, 1050, 1400]) {
    test(`audit-like standalone image centers at ${width}px in ${mode}`, async ({
      page,
    }, testInfo) => {
      await open(page, mode, width);
      const media = page.frameLocator(".epub-container iframe").first().locator("#isolated-image");
      await expect
        .poll(async () => Math.abs((await geometry(media)).centerError))
        .toBeLessThanOrEqual(1);
      const sample = await geometry(media);
      expect(sample.width).toBeLessThanOrEqual(sample.sourceWidth);
      expect(sample.width / sample.height).toBeCloseTo(sample.sourceWidth / sample.sourceHeight, 2);
      await testInfo.attach("media-geometry", {
        body: JSON.stringify(sample),
        contentType: "application/json",
      });
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}-media.png`) });
    });
  }

  for (const width of [900, 1050, 1400]) {
    test(`wrapper picture SVG intrinsic size and fit contracts at ${width}px in ${mode}`, async ({
      page,
    }, testInfo) => {
      await open(page, mode, width);
      const samples = [];
      for (const [section, id] of [
        ["nested-media", "nested-plate"],
        ["linked-media", "linked-plate"],
        ["vector-media", "vector-plate"],
        ["oversize-media", "oversize-plate"],
        ["small-media", "small-plate"],
        ["wide-media", "wide-plate"],
      ]) {
        await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
        expect(
          await page.evaluate((section) => window.readerInteractions.navigate(section), section),
        ).toBe(true);
        const media = illustration(page, section, id);
        for (const readingWidth of ["narrow", "comfortable", "wide", "full"] as const) {
          await page.evaluate(
            (readingWidth) => window.readerInteractions.settings({ readingWidth }),
            readingWidth,
          );
          await expect
            .poll(() =>
              media.evaluate(
                (el) =>
                  el.ownerDocument.getElementById("archeion-reader-reflowable-layout")?.dataset
                    .readerWidth,
              ),
            )
            .toBe(readingWidth);
          await expect
            .poll(async () => Math.abs((await geometry(media)).centerError), {
              message: `${section} ${readingWidth}: ${JSON.stringify(await geometry(media))}`,
            })
            .toBeLessThanOrEqual(1);
          const sample = await geometry(media);
          expect(sample.width).toBeGreaterThan(0);
          expect(sample.width).toBeLessThanOrEqual(id === "small-plate" ? 96 : sample.sourceWidth);
          expect(sample.width / sample.height).toBeCloseTo(
            sample.sourceWidth / sample.sourceHeight,
            2,
          );
          expect(sample.height).toBeLessThan(750);
          if (id === "wide-plate") {
            const available = await media.evaluate((el) => {
              const probe = el.ownerDocument.createElement("div");
              probe.style.width = "var(--archeion-reader-media-measure)";
              el.ownerDocument.body.appendChild(probe);
              const width = probe.getBoundingClientRect().width;
              probe.remove();
              return width;
            });
            expect(sample.width).toBeLessThanOrEqual(available + 1);
          }
          samples.push({ section, readingWidth, ...sample });
        }
        if (section === "linked-media") {
          expect(
            await media.evaluate((img) =>
              img.closest("picture")?.querySelector("source")?.getAttribute("srcset"),
            ),
          ).toContain("data:image/svg+xml,");
          await settle(page);
          await media.locator("xpath=ancestor::a").click();
          await expect(illustration(page, "composition", "caption")).toBeVisible();
          await settle(page);
          const captionCfi = await page.evaluate(() => window.readerInteractions.cfi("caption"));
          expect(
            await page.evaluate(
              (cfi) => window.readerInteractions.passageAt(cfi)?.visible,
              captionCfi,
            ),
          ).toBe(true);
        }
      }
      await testInfo.attach("standalone-matrix", {
        body: JSON.stringify(samples),
        contentType: "application/json",
      });
    });
  }

  test(`publisher disables discretionary centering and preserves composition in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    const media = illustration(page, "isolated", "isolated-image");
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await expect.poll(async () => (await geometry(media)).centered).toBe(false);
    expect(Math.abs((await geometry(media)).centerError)).toBeGreaterThan(100);
    await page.evaluate(() => window.readerInteractions.navigate("composition"));
    const caption = illustration(page, "composition", "caption-image");
    const composition = async () =>
      caption.evaluate((img) =>
        ["float-image", "grid-image", "flex-image", "caption-image", "mapped-image"].map((id) => {
          const el = img.ownerDocument.getElementById(id)!;
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            id,
            width: box.width,
            height: box.height,
            display: style.display,
            float: style.float,
            centered: el.hasAttribute("data-archeion-media-center"),
          };
        }),
      );
    const before = await composition();
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await expect.poll(composition).toEqual(before);
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    expect(await page.evaluate(() => window.readerInteractions.navigate("intentional-media"))).toBe(
      true,
    );
    for (const id of ["offset-plate", "heading-ornament", "inline-symbol", "deep-grid-plate"]) {
      expect(
        await illustration(page, "intentional-media", id).evaluate((el) =>
          el.hasAttribute("data-archeion-media-center"),
        ),
      ).toBe(false);
    }
    expect(await page.evaluate(() => window.readerInteractions.navigate("composition"))).toBe(true);
    const mapped = illustration(page, "composition", "mapped-image");
    await mapped.click({ position: { x: 25, y: 25 } });
    await expect(illustration(page, "composition", "caption")).toBeVisible();
    await testInfo.attach("protected-media", {
      body: JSON.stringify(before),
      contentType: "application/json",
    });
  });

  test(`Publisher retains essential oversized-media safety in ${mode}`, async ({ page }) => {
    await open(page, mode);
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    expect(await page.evaluate(() => window.readerInteractions.navigate("oversize-media"))).toBe(
      true,
    );
    const media = illustration(page, "oversize-media", "oversize-plate");
    await expect.poll(async () => (await geometry(media)).height).toBeLessThanOrEqual(600);
    const sample = await geometry(media);
    expect(sample.centered).toBe(false);
    expect(sample.width).toBeLessThanOrEqual(1050);
    expect(
      await media.evaluate((img) => img.ownerDocument.defaultView!.getComputedStyle(img).objectFit),
    ).toBe("contain");
  });
}

test("late image decode and stage/font changes preserve the visible Continuous passage", async ({
  page,
}, testInfo) => {
  await open(page, "continuous");
  expect(await page.evaluate(() => window.readerInteractions.navigate("media-passage"))).toBe(true);
  const cfi = await page.evaluate(() => window.readerInteractions.cfi("media-passage-p3"));
  expect(await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), cfi)).toBe(true);
  await settle(page);
  const before = await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi), cfi);
  expect(before?.visible).toBe(true);
  const media = illustration(page, "media-passage", "late-plate");
  for (const width of [210, 420]) {
    await settle(page);
    await media.evaluate((img, width) => {
      (img as HTMLImageElement).src =
        `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${(width * 4) / 3}" viewBox="0 0 420 560"><rect width="420" height="560" fill="#53778c"/></svg>`)}`;
    }, width);
    await expect.poll(async () => (await geometry(media)).width).toBe(width);
    await expect
      .poll(async () =>
        Math.abs(
          (await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi), cfi))!.y -
            before!.y,
        ),
      )
      .toBeLessThanOrEqual(2);
  }
  await page.evaluate(() =>
    window.readerInteractions.settings({ fontSize: 24, readingWidth: "narrow" }),
  );
  await expect
    .poll(() => page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, cfi))
    .toBe(true);
  await page.locator("#root").evaluate((root) => {
    root.style.width = "900px";
  });
  await expect
    .poll(() => page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, cfi))
    .toBe(true);
  expect(await page.evaluate(() => window.readerInteractions.cfi("media-passage-p3"))).toBe(cfi);
  await testInfo.attach("media-passage", {
    body: JSON.stringify({
      cfi,
      before,
      after: await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi), cfi),
    }),
    contentType: "application/json",
  });
});

for (const mode of ["continuous", "paged"] as const) {
  for (const width of [900, 1050, 1400]) {
    test(`opening artwork classification at ${width}px in ${mode}`, async ({ page }, testInfo) => {
      await open(page, mode, width);
      const samples = [];
      for (const [section, id] of [
        ["heading-art", "heading-plate"],
        ["pagination-art", "pagination-plate"],
        ["auto-margin-art", "auto-plate"],
        ["rtl-auto-art", "rtl-auto-plate"],
      ]) {
        expect(
          await page.evaluate((section) => window.readerInteractions.navigate(section), section),
        ).toBe(true);
        const media = illustration(page, section, id);
        for (const readingWidth of ["narrow", "comfortable", "wide", "full"] as const) {
          await page.evaluate(
            (readingWidth) => window.readerInteractions.settings({ readingWidth }),
            readingWidth,
          );
          await expect
            .poll(() =>
              media.evaluate(
                (el) =>
                  el.ownerDocument.getElementById("archeion-reader-reflowable-layout")?.dataset
                    .readerWidth,
              ),
            )
            .toBe(readingWidth);
          await expect
            .poll(async () => Math.abs((await geometry(media)).centerError), {
              message: `${section} at ${width}px, ${readingWidth}`,
            })
            .toBeLessThanOrEqual(1);
          const sample = await geometry(media);
          expect(sample.centered).toBe(true);
          expect(sample.width).toBeGreaterThan(0);
          expect(sample.width).toBeLessThanOrEqual(sample.sourceWidth);
          expect(sample.height).toBeLessThanOrEqual(600);
          expect(sample.width / sample.height).toBeCloseTo(
            sample.sourceWidth / sample.sourceHeight,
            2,
          );
          samples.push({ section, readingWidth, ...sample });
        }
        await settle(page);
        if (section === "heading-art")
          await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}-heading-art.png`) });
      }
      await testInfo.attach("opening-artwork-geometry", {
        body: JSON.stringify(samples),
        contentType: "application/json",
      });
    });
  }
}

for (const mode of ["continuous", "paged"] as const) {
  test(`opening artwork policy reverses remounts and preserves composed controls in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    const samples = [];
    for (const [section, id] of [
      ["heading-art", "heading-plate"],
      ["pagination-art", "pagination-plate"],
      ["auto-margin-art", "auto-plate"],
    ]) {
      expect(
        await page.evaluate((section) => window.readerInteractions.navigate(section), section),
      ).toBe(true);
      const media = illustration(page, section, id);
      await settle(page);
      const reference = await geometry(media);
      await page.evaluate(() => window.readerInteractions.presentation("publisher"));
      await expect.poll(async () => (await geometry(media)).centered).toBe(false);
      await settle(page);
      expect(await media.evaluate((el) => el.hasAttribute("data-archeion-media-natural-fit"))).toBe(
        false,
      );
      expect(await media.evaluate((el) => (el as HTMLElement).style.width)).toBe("");
      expect(await media.evaluate((el) => (el as HTMLElement).style.height)).toBe("");
      const publisher = await geometry(media);
      await page.evaluate(() => window.readerInteractions.presentation("archeion"));
      await expect
        .poll(async () => Math.abs((await geometry(media)).centerError))
        .toBeLessThanOrEqual(1);
      await settle(page);
      expect((await geometry(media)).width).toBeCloseTo(reference.width, 1);
      expect((await geometry(media)).height).toBeCloseTo(reference.height, 1);
      samples.push({ section, archeion: reference, publisher });
    }
    expect(
      await page.evaluate(() => window.readerInteractions.navigate("opening-art-controls")),
    ).toBe(true);
    for (const id of [
      "solitary-ornament",
      "mixed-heading-plate",
      "caption-sibling-plate",
      "double-break-plate",
      "leading-break-plate",
      "fixed-offset-plate",
      "mixed-offset-plate",
    ])
      expect((await geometry(illustration(page, "opening-art-controls", id))).centered).toBe(false);
    const offsets = await illustration(page, "opening-art-controls", "fixed-offset-plate").evaluate(
      (el) => ({
        fixed: getComputedStyle(el).marginLeft,
        mixed: getComputedStyle(el.ownerDocument.getElementById("mixed-offset-plate")!).marginRight,
      }),
    );
    expect(offsets).toEqual({ fixed: "24px", mixed: "24px" });
    const tocLink = illustration(page, "opening-art-controls", "opening-toc-link");
    await tocLink.focus();
    await expect(tocLink).toBeFocused();
    await page.keyboard.press("Enter");
    await settle(page);
    const remounted = illustration(page, "heading-art", "heading-plate");
    await expect(remounted).toBeVisible();
    await expect
      .poll(async () => Math.abs((await geometry(remounted)).centerError))
      .toBeLessThanOrEqual(1);
    await page.evaluate(
      (mode) => window.readerInteractions.open("image-only", mode, "media-remount"),
      mode,
    );
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    expect(await page.evaluate(() => window.readerInteractions.navigate("heading-art"))).toBe(true);
    await expect
      .poll(async () =>
        Math.abs((await geometry(illustration(page, "heading-art", "heading-plate"))).centerError),
      )
      .toBeLessThanOrEqual(1);
    await testInfo.attach("opening-artwork-publisher-controls", {
      body: JSON.stringify({ samples, offsets }),
      contentType: "application/json",
    });
  });

  test(`annotated caption and illustration activation retain their hitboxes in ${mode}`, async ({
    page,
  }) => {
    await open(page, mode);
    expect(await page.evaluate(() => window.readerInteractions.navigate("composition"))).toBe(true);
    const highlight = await page.evaluate(() => window.readerInteractions.saveHighlight("caption"));
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    const caption = illustration(page, "composition", "caption");
    const before = await caption.evaluate((el) => ({
      alignment: getComputedStyle(el).textAlign,
      text: el.textContent,
    }));
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await settle(page);
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await settle(page);
    expect(
      await caption.evaluate((el) => ({
        alignment: getComputedStyle(el).textAlign,
        text: el.textContent,
      })),
    ).toEqual(before);
    expect(await page.evaluate(() => window.readerInteractions.cfi("caption"))).toBe(
      highlight.cfiRange,
    );
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    expect(await page.evaluate(() => window.readerInteractions.navigate("heading-art"))).toBe(true);
    const media = illustration(page, "heading-art", "heading-plate");
    await settle(page);
    await media.focus();
    await expect(media).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Illustration", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Illustration", exact: true })).toHaveCount(0);
    await expect(media).toBeFocused();
  });
}
