import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const value = await page.evaluate(() => {
          const geometry = [
            ...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe"),
          ].map((frame) => {
            const body = frame.contentDocument?.body;
            return body
              ? [frame.getBoundingClientRect().toJSON(), body.getBoundingClientRect().toJSON()]
              : null;
          });
          if (!geometry.length || geometry.includes(null)) return null;
          return JSON.stringify([window.readerInteractions.location(), ...geometry]);
        });
        if (value === null) {
          previous = "";
          stable = 0;
          return stable;
        }
        stable = value === previous ? stable + 1 : 0;
        previous = value;
        return stable;
      },
      { intervals: [100], timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3);
}

async function open(page: Page, mode: "continuous" | "paged", width = 1050) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.locator("#root").evaluate((root, width) => {
    root.style.width = `${width}px`;
  }, width);
  await page.evaluate((mode) => window.readerInteractions.open("semantic-structures", mode), mode);
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await settle(page);
}

async function geometry(page: Page, title: string, ids: string[]) {
  return page.evaluate(
    ({ title, ids }) => {
      const frame = [
        ...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe"),
      ].find((frame) => frame.contentDocument?.title === title)!;
      const doc = frame.contentDocument!;
      const nodes = Object.fromEntries(
        ids.map((id) => {
          const node = doc.getElementById(id)!;
          const box = node.getBoundingClientRect();
          const style = doc.defaultView!.getComputedStyle(node);
          return [
            id,
            {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              center: box.x + box.width / 2,
              marginStart: style.marginInlineStart,
              marginEnd: style.marginInlineEnd,
              computedWidth: style.width,
              textAlign: style.textAlign,
              textIndent: style.textIndent,
              direction: style.direction,
              columnCount: style.columnCount,
              prose: node.getAttribute("data-archeion-running-prose"),
              flow: node.getAttribute("data-archeion-prose-flow"),
              toc: node.getAttribute("data-archeion-toc-flow"),
            },
          ];
        }),
      );
      return {
        stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
        frame: frame.getBoundingClientRect().toJSON(),
        body: doc.body.getBoundingClientRect().toJSON(),
        nodes,
      };
    },
    { title, ids },
  );
}

async function revealForScreenshot(
  page: Page,
  title: string,
  id: string,
  mode: "continuous" | "paged",
) {
  if (mode !== "continuous") return;
  await page.evaluate(
    ({ title, id }) => {
      const scroller = document.querySelector<HTMLElement>(".epub-container")!;
      const frame = [...scroller.querySelectorAll<HTMLIFrameElement>("iframe")].find(
        (frame) => frame.contentDocument?.title === title,
      )!;
      const offset =
        frame.getBoundingClientRect().top +
        frame.contentDocument!.getElementById(id)!.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
      scroller.scrollTop += offset - 16;
    },
    { title, id },
  );
  await settle(page);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

test("geometry settlement waits for an iframe body before counting stable samples", async ({
  page,
}) => {
  await page.setContent('<div class="epub-container"><iframe></iframe></div>');
  const heldBody = await page.evaluateHandle(() => {
    Object.defineProperty(window, "readerInteractions", { value: { location: () => null } });
    const frame = document.querySelector("iframe")!;
    const doc = frame.contentDocument!;
    const body = doc.body;
    const readBody = Object.getOwnPropertyDescriptor(Document.prototype, "body")!.get!;
    let reads = 0;
    doc.documentElement.removeChild(body);
    Object.defineProperty(doc, "body", {
      configurable: true,
      get() {
        frame.dataset.bodyReads = String(++reads);
        return readBody.call(doc);
      },
    });
    return body;
  });
  let completed = false;
  const settlement = settle(page).then(
    () => {
      completed = true;
      return { error: null };
    },
    (error: unknown) => {
      completed = true;
      return { error };
    },
  );
  await expect
    .poll(async () => {
      const reads = Number(await page.locator("iframe").getAttribute("data-body-reads"));
      return completed || reads >= 5;
    })
    .toBe(true);
  if (completed) {
    const result = await settlement;
    if (result.error) throw result.error;
  }
  expect(completed).toBe(false);
  await heldBody.evaluate((body) => {
    body.ownerDocument.documentElement.append(body);
    Reflect.deleteProperty(body.ownerDocument, "body");
  });
  expect((await settlement).error).toBeNull();
});

for (const mode of ["continuous", "paged"] as const) {
  for (const stage of [900, 1050, 1400]) {
    test(`semantic TOC shares the reading column in ${mode} at ${stage}px`, async ({
      page,
    }, testInfo) => {
      await open(page, mode, stage);
      const samples = [];
      for (const width of ["narrow", "comfortable", "wide", "full"] as const) {
        await page.evaluate(
          (readingWidth) => window.readerInteractions.settings({ readingWidth }),
          width,
        );
        await settle(page);
        const sample = await geometry(page, "structural-toc", [
          "semantic-toc",
          "toc-list",
          "toc-measure",
          "toc-nested",
          "toc-chapter-link",
          "toc-long-link",
        ]);
        samples.push({ width, ...sample });
        await testInfo.attach(`toc-${width}`, {
          body: JSON.stringify(sample),
          contentType: "application/json",
        });
        const { "semantic-toc": nav, "toc-list": list, "toc-measure": measure } = sample.nodes;
        expect(Math.abs(list.center - measure.center)).toBeLessThanOrEqual(1);
        expect(list.width).toBeLessThanOrEqual(measure.width + 1);
        expect(nav.width).toBeCloseTo(measure.width, 0);
        expect(list.textAlign).toBe("start");
        expect(sample.nodes["toc-chapter-link"].textIndent).toBe("-36px");
        expect(sample.nodes["toc-nested"].x).toBeGreaterThan(list.x);
        expect(sample.nodes["toc-long-link"].height).toBeGreaterThan(27);
        expect(list.prose).toBeNull();
        if (width === "comfortable")
          await page.screenshot({ path: testInfo.outputPath("semantic-toc-comfortable.png") });
      }
      await page.screenshot({ path: testInfo.outputPath("semantic-toc.png") });
      await testInfo.attach("toc-matrix", {
        body: JSON.stringify(samples),
        contentType: "application/json",
      });
    });
  }

  test(`chapter-title diagnostic in the production Viewer in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    await page.evaluate(() => window.readerInteractions.navigate("structural-chapter"));
    for (const policy of ["publisher", "archeion"] as const) {
      await page.evaluate((policy) => window.readerInteractions.presentation(policy), policy);
      await settle(page);
      const sample = await geometry(page, "structural-chapter", [
        "chapter-root",
        "chapter-title",
        "chapter-anchor",
      ]);
      await testInfo.attach(`title-${policy}`, {
        body: JSON.stringify(sample),
        contentType: "application/json",
      });
      expect(
        Math.abs(sample.nodes["chapter-title"].center - sample.nodes["chapter-anchor"].center),
      ).toBeLessThanOrEqual(1);
      expect(sample.nodes["chapter-title"].textAlign).not.toBe("center");
      expect(parseFloat(sample.nodes["chapter-title"].textIndent)).toBeCloseTo((20 * 96) / 72, 2);
    }
    await revealForScreenshot(page, "structural-chapter", "chapter-title", mode);
    await page.screenshot({ path: testInfo.outputPath("chapter-title.png") });
  });

  test(`imprint diagnostic preserves centered narrow blocks in the production Viewer in ${mode}`, async ({
    page,
  }, testInfo) => {
    await open(page, mode);
    await page.evaluate(() => window.readerInteractions.navigate("structural-imprint"));
    for (const policy of ["publisher", "archeion"] as const) {
      await page.evaluate((policy) => window.readerInteractions.presentation(policy), policy);
      await settle(page);
      const sample = await geometry(page, "structural-imprint", [
        "imprint-section",
        "imprint-header",
        "imprint-logo",
        "imprint-first",
        "imprint-second",
      ]);
      await testInfo.attach(`imprint-${policy}`, {
        body: JSON.stringify(sample),
        contentType: "application/json",
      });
      const section = sample.nodes["imprint-section"];
      for (const id of ["imprint-logo", "imprint-first", "imprint-second"])
        expect(Math.abs(sample.nodes[id].center - section.center)).toBeLessThanOrEqual(1);
      expect(sample.nodes["imprint-first"].width / section.width).toBeCloseTo(0.75, 2);
      expect(sample.nodes["imprint-first"].textAlign).toBe("justify");
    }
    await revealForScreenshot(page, "structural-imprint", "imprint-logo", mode);
    await page.screenshot({ path: testInfo.outputPath("imprint.png") });
  });

  test(`TOC composition, RTL, navigation and remount remain intact in ${mode}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await open(page, mode);
    await page.evaluate(() => window.readerInteractions.navigate("structural-composed"));
    for (const width of ["narrow", "comfortable", "wide", "full"] as const) {
      for (const policy of ["publisher", "archeion"] as const) {
        await page.evaluate(
          ({ width, policy }) => {
            window.readerInteractions.settings({ readingWidth: width });
            window.readerInteractions.presentation(policy);
          },
          { width, policy },
        );
        await settle(page);
        const sample = await geometry(page, "structural-composed", [
          "composed-toc",
          "offset-toc",
          "column-toc",
          "ordinary-nav",
        ]);
        await testInfo.attach(`composed-${width}-${policy}`, {
          body: JSON.stringify(sample),
          contentType: "application/json",
        });
        expect(sample.nodes["composed-toc"].width).toBe(240);
        expect(sample.nodes["composed-toc"].marginStart).toBe("96px");
        expect(sample.nodes["offset-toc"].marginStart).toBe("80px");
        expect(sample.nodes["column-toc"].columnCount).toBe("2");
        for (const node of Object.values(sample.nodes)) expect(node.toc).toBeNull();
      }
    }
    await page.evaluate(() => window.readerInteractions.navigate("structural-rtl"));
    await settle(page);
    const rtl = await geometry(page, "structural-rtl", [
      "rtl-toc",
      "rtl-list",
      "rtl-measure",
      "rtl-link",
    ]);
    expect(
      Math.abs(rtl.nodes["rtl-toc"].center - rtl.nodes["rtl-measure"].center),
    ).toBeLessThanOrEqual(1);
    expect(rtl.nodes["rtl-toc"].width).toBeCloseTo(rtl.nodes["rtl-measure"].width, 0);
    expect(rtl.nodes["rtl-link"].direction).toBe("rtl");
    expect(rtl.nodes["rtl-link"].textAlign).toBe("start");
    await testInfo.attach("rtl", { body: JSON.stringify(rtl), contentType: "application/json" });

    await page.evaluate(() => window.readerInteractions.navigate("structural-toc"));
    await settle(page);
    await page.evaluate(() => window.readerInteractions.presentation("publisher"));
    await settle(page);
    const publisher = await geometry(page, "structural-toc", ["semantic-toc", "toc-list"]);
    await page.evaluate(() => window.readerInteractions.presentation("archeion"));
    await settle(page);
    const original = await geometry(page, "structural-toc", ["semantic-toc", "toc-list"]);
    const cfi = await page.evaluate(() => window.readerInteractions.cfi("toc-chapter-link"));
    for (const policy of ["publisher", "archeion", "publisher", "archeion"] as const) {
      await page.evaluate((policy) => window.readerInteractions.presentation(policy), policy);
      await settle(page);
      expect(await page.evaluate(() => window.readerInteractions.cfi("toc-chapter-link"))).toBe(
        cfi,
      );
      const sample = await geometry(page, "structural-toc", ["semantic-toc", "toc-list"]);
      expect(sample.nodes["semantic-toc"].toc).toBe(policy === "archeion" ? "" : null);
      if (policy === "archeion")
        expect(sample.nodes["toc-list"].width).toBeCloseTo(original.nodes["toc-list"].width, 0);
      else expect(sample.nodes["toc-list"].width).toBeCloseTo(publisher.nodes["toc-list"].width, 0);
      expect(
        await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, cfi),
      ).toBe(true);
    }

    let chapter = page.frames().find((frame) => frame.name().includes("epubjs"));
    for (const frame of page.frames())
      if ((await frame.title()) === "structural-toc") chapter = frame;
    const link = chapter!.locator("#toc-chapter-link");
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await settle(page);
    const headingCfi = await page.evaluate(() => window.readerInteractions.cfi("chapter-anchor"));
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, headingCfi),
    ).toBe(true);

    await page.evaluate(() => window.readerInteractions.navigate("structural-toc"));
    await settle(page);
    for (const frame of page.frames())
      if ((await frame.title()) === "structural-toc") chapter = frame;
    await page.evaluate(() => {
      const frame = [
        ...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe"),
      ].find((frame) => frame.contentDocument?.title === "structural-toc")!;
      frame.dataset.followupTocView = "original";
    });
    const oldFrame = await page
      .locator('iframe[data-followup-toc-view="original"]')
      .elementHandle();
    await chapter!.locator("#toc-long-link").click();
    await settle(page);
    const lateCfi = await page.evaluate(() => window.readerInteractions.cfi("chapter-late"));
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, lateCfi),
    ).toBe(true);
    await page.evaluate(() => window.readerInteractions.navigate("structural-tail-40"));
    await settle(page);
    expect(await oldFrame!.evaluate((element) => element.isConnected)).toBe(false);
    await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), cfi);
    await settle(page);
    expect(await page.evaluate(() => window.readerInteractions.cfi("toc-chapter-link"))).toBe(cfi);
    expect(
      (await geometry(page, "structural-toc", ["semantic-toc"])).nodes["semantic-toc"].toc,
    ).toBe("");
    await page.evaluate(
      (flow) =>
        window.readerInteractions.settings({ mode: flow === "paged" ? "continuous" : "paged" }),
      mode,
    );
    await settle(page);
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, cfi),
    ).toBe(true);
    expect(await page.evaluate(() => window.readerInteractions.cfi("toc-chapter-link"))).toBe(cfi);
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  });
}
