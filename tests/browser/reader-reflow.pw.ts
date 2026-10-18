import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page, mode: "continuous" | "paged" = "continuous") {
  let previous = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const sample = await page.evaluate((flow) => {
          const scroller = document.querySelector<HTMLElement>(".epub-container")!;
          if (
            ![...scroller.querySelectorAll<HTMLIFrameElement>("iframe")].some(
              (frame) =>
                frame.contentDocument?.querySelector("p") &&
                getComputedStyle(frame).visibility !== "hidden",
            )
          )
            return null;
          const cfi = window.readerInteractions.location();
          const passage =
            flow === "paged"
              ? cfi && window.readerInteractions.passageAt(cfi)
              : window.readerInteractions.passage();
          if (!passage) return null;
          return [
            scroller.scrollTop,
            scroller.scrollLeft,
            scroller.scrollHeight,
            scroller.scrollWidth,
            passage,
          ];
        }, mode);
        if (!sample) {
          stable = 0;
          return stable;
        }
        const signature = JSON.stringify(sample);
        stable = previous === signature ? stable + 1 : 0;
        previous = signature;
        return stable;
      },
      { intervals: [100], timeout: 8000 },
    )
    .toBeGreaterThanOrEqual(4);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(() => window.readerInteractions.open("reverse-prepend"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(async () => {
    await window.readerInteractions.navigate(window.readerInteractions.cfi("previous-tall-p8"));
    document.querySelector<HTMLElement>(".epub-container")!.scrollTop += 137;
  });
  await settle(page);
});

test("stage reflow restores the visible text CFI across 900 to 1200 to 900 widths", async ({
  page,
}, testInfo) => {
  await page.locator("#root").evaluate((root) => {
    root.style.width = "900px";
  });
  await settle(page);
  const before = await page.evaluate(() => ({
    passage: window.readerInteractions.passage(),
    history: window.readerInteractions.history(),
    relocations: window.readerInteractions.relocations(),
  }));
  const samples = [];
  for (const width of [1200, 900]) {
    await page.locator("#root").evaluate((root, value) => {
      root.style.width = `${value}px`;
    }, width);
    await settle(page);
    await settle(page);
    const after = await page.evaluate(
      (cfi) => window.readerInteractions.passageAt(cfi),
      before.passage.cfi,
    );
    expect(after?.visible).toBe(true);
    expect(after?.text).toBe(before.passage.text);
    expect(Math.abs(after!.y - before.passage.y)).toBeLessThanOrEqual(2);
    samples.push(after);
  }
  expect(await page.evaluate(() => window.readerInteractions.history())).toEqual(before.history);
  expect(await page.evaluate(() => window.readerInteractions.relocations())).toBe(
    before.relocations,
  );
  await testInfo.attach("stage-reflow", {
    body: JSON.stringify({ before, samples }),
    contentType: "application/json",
  });
  await page.locator(".epub-container").evaluate((element) => {
    element.scrollTop += 160;
  });
  await expect
    .poll(() => page.evaluate(() => window.readerInteractions.relocations()))
    .toBeGreaterThan(before.relocations);
});

test("font family size line height and measure preserve the visible passage", async ({
  page,
}, testInfo) => {
  const before = await page.evaluate(() => window.readerInteractions.passage());
  const samples = [];
  for (const patch of [
    { fontSize: 24 },
    { lineHeight: 1.9 },
    { fontFamily: { kind: "builtin", id: "literata" } },
    { readingWidth: "narrow" },
  ] as const) {
    await page.evaluate((value) => window.readerInteractions.settings(value), patch);
    await settle(page);
    const after = await page.evaluate(
      (cfi) => window.readerInteractions.passageAt(cfi),
      before.cfi,
    );
    expect(after?.visible).toBe(true);
    expect(after?.text).toBe(before.text);
    samples.push(after);
  }
  await testInfo.attach("typography-reflow", {
    body: JSON.stringify({ before, samples }),
    contentType: "application/json",
  });
});

test("rapid sizes followed by deliberate navigation retain the latest destination", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const root = document.getElementById("root")!;
    for (const width of [1100, 900, 1200]) root.style.width = `${width}px`;
    await window.readerInteractions.navigate("current");
  });
  await settle(page);
  const passage = await page.evaluate(() => window.readerInteractions.passage());
  expect(passage.cfi).toContain("/6/6[current]");
});

test("all overlay shells retain stage geometry and iframe identity", async ({ page }) => {
  const before = await page.evaluate(() => ({
    geometry: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
    history: window.readerInteractions.history(),
    relocations: window.readerInteractions.relocations(),
  }));
  const frame = await page.locator(".epub-viewer iframe").first().elementHandle();
  for (const kind of [
    "search",
    "annotations",
    "navigation",
    "settings",
    "footnote",
    "illustration",
    "illustration-loading",
  ] as const) {
    await page.evaluate((value) => window.readerInteractions.showOverlay(value), kind);
    await settle(page);
    expect(await frame!.evaluate((element) => element.isConnected)).toBe(true);
    expect(
      await page
        .locator(".epub-container")
        .evaluate((element) => element.getBoundingClientRect().toJSON()),
    ).toEqual(before.geometry);
    await page.evaluate(() => window.readerInteractions.closeOverlay());
    await settle(page);
    expect(await frame!.evaluate((element) => element.isConnected)).toBe(true);
  }
  expect(await page.evaluate(() => window.readerInteractions.history())).toEqual(before.history);
  expect(await page.evaluate(() => window.readerInteractions.relocations())).toBe(
    before.relocations,
  );
});

test("real height changes from reserved chrome retain the passage", async ({ page }) => {
  const before = await page.evaluate(() => window.readerInteractions.passage());
  for (const height of [698, 750]) {
    await page.locator("#root").evaluate((root, value) => {
      root.style.height = `${value}px`;
    }, height);
    await settle(page);
    const after = await page.evaluate(
      (cfi) => window.readerInteractions.passageAt(cfi),
      before.cfi,
    );
    expect(after?.visible).toBe(true);
    expect(Math.abs(after!.y - before.y)).toBeLessThanOrEqual(2);
  }
});

test("Paged resize and typography retain the visible passage", async ({ page }) => {
  await page.evaluate(() => window.readerInteractions.open("reverse-prepend", "paged"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  const cfi = await page.evaluate(() => window.readerInteractions.cfi("previous-tall-p8"));
  await page.evaluate((target) => window.readerInteractions.navigate(target), cfi);
  await expect
    .poll(() =>
      page.evaluate((target) => window.readerInteractions.passageAt(target)?.visible, cfi),
    )
    .toBe(true);
  for (const width of [900, 1200, 900]) {
    await page.locator("#root").evaluate((root, value) => {
      root.style.width = `${value}px`;
    }, width);
    await expect
      .poll(() =>
        page.evaluate((target) => window.readerInteractions.passageAt(target)?.visible, cfi),
      )
      .toBe(true);
  }
  const firstVisible = await page.evaluate(() => window.readerInteractions.location());
  expect(firstVisible).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(
        (target) => window.readerInteractions.passageAt(target!)?.visible,
        firstVisible,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.readerInteractions.settings({ fontSize: 22, lineHeight: 1.8 }));
  await expect
    .poll(() =>
      page.evaluate(
        (target) => window.readerInteractions.passageAt(target!)?.visible,
        firstVisible,
      ),
    )
    .toBe(true);
});

test("book replacement cancels a pending reflow and protects fixed layout", async ({ page }) => {
  await page.evaluate(async () => {
    document.getElementById("root")!.style.width = "1200px";
    await window.readerInteractions.open("fixed-layout", "continuous", "archive-b");
  });
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  const label = page.frameLocator(".epub-viewer iframe").locator("#page-one-anchor");
  await expect(label).toBeVisible();
  const font = await label.evaluate((element) => getComputedStyle(element).fontSize);
  await page.evaluate(() =>
    window.readerInteractions.settings({ fontSize: 30, readingWidth: "narrow" }),
  );
  await page.locator("#root").evaluate((root) => {
    root.style.width = "900px";
  });
  // A real stage resize rebuilds the fixed-layout view on the next layout frames.
  await settle(page, "paged");
  await expect(label).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const element = document
          .querySelector<HTMLIFrameElement>(".epub-viewer iframe")
          ?.contentDocument?.getElementById("page-one-anchor");
        return element && element.ownerDocument.defaultView!.getComputedStyle(element).fontSize;
      }),
    )
    .toBe(font);
  expect(await page.locator(".epub-viewer iframe").count()).toBe(1);
  expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
});

for (const mode of ["continuous", "paged"] as const) {
  test(`${mode} coalesces appearance and stage changes around one visible passage`, async ({
    page,
  }) => {
    await page.evaluate((value) => window.readerInteractions.open("reverse-prepend", value), mode);
    await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
    const target = await page.evaluate(() => window.readerInteractions.cfi("previous-tall-p8"));
    await page.evaluate((value) => window.readerInteractions.navigate(value), target);
    await settle(page, mode);
    const anchor = await page.evaluate(
      (value) =>
        value === "continuous"
          ? window.readerInteractions.passage().cfi
          : window.readerInteractions.location()!,
      mode,
    );
    await expect
      .poll(() =>
        page.evaluate((value) => window.readerInteractions.passageAt(value)?.visible, anchor),
      )
      .toBe(true);
    await page.evaluate(() => {
      window.readerInteractions.settings({ fontSize: 24, lineHeight: 1.8 });
      window.readerInteractions.settings({ fontSize: 28, lineHeight: 2 });
      const root = document.getElementById("root")!;
      root.style.width = "1200px";
      root.style.height = "600px";
    });
    await settle(page, mode);
    await expect
      .poll(() =>
        page.evaluate((value) => window.readerInteractions.passageAt(value)?.visible, anchor),
      )
      .toBe(true);
  });
}

test("near book end shrink and stage growth retain the nearest visible passage and resume progress", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.evaluate(() => window.readerInteractions.open("long-spine"));
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await page.evaluate(() => window.readerInteractions.navigate("section-42"));
  await settle(page);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".epub-container")!;
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
  });
  await settle(page);
  const before = await page.evaluate(() => ({
    passage: window.readerInteractions.passage(),
    history: window.readerInteractions.history(),
    atBookEnd: (() => {
      const scroller = document.querySelector<HTMLElement>(".epub-container")!;
      return Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight)) <= 1;
    })(),
  }));
  expect(before.atBookEnd).toBe(true);
  await page.evaluate(() => {
    window.readerInteractions.settings({ fontSize: 18, lineHeight: 1.5 });
    document.getElementById("root")!.style.height = "850px";
  });
  await settle(page);
  const after = await page.evaluate((cfi) => {
    const scroller = document.querySelector<HTMLElement>(".epub-container")!;
    return {
      passage: window.readerInteractions.passage(),
      original: window.readerInteractions.passageAt(cfi),
      scrollTop: scroller.scrollTop,
      maximum: scroller.scrollHeight - scroller.clientHeight,
      relocations: window.readerInteractions.relocations(),
    };
  }, before.passage.cfi);
  await testInfo.attach("book-end-clamped-reflow", {
    body: JSON.stringify({ before, after }),
    contentType: "application/json",
  });
  expect(after.original?.visible).toBe(true);
  expect(after.original?.text).toBe(before.passage.text);
  expect(Math.abs(after.scrollTop - after.maximum)).toBeLessThanOrEqual(1);
  expect(after.maximum).toBeGreaterThan(0);
  expect(Math.abs(after.original!.y - before.passage.y)).toBeGreaterThan(2);
  expect(await page.evaluate(() => window.readerInteractions.history())).toEqual(before.history);
  await page.locator(".epub-container").evaluate((element) => {
    element.scrollTop -= 120;
  });
  await expect
    .poll(() => page.evaluate(() => window.readerInteractions.relocations()))
    .toBeGreaterThan(after.relocations);
});
