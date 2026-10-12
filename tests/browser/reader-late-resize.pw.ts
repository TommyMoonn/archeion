import { expect, test, type Page } from "@playwright/test";
import {
  ReaderRuntimeDriver,
  assertVisibleAnchorStable,
  findAnchor,
} from "./reader-runtime-driver";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

async function resizeImage(page: Page, height: number) {
  await page.evaluate((value) => window.readerFixture.changeImageSize(value), height);
}

test("late image growth and shrink in a prior section preserve passage and CFI", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "previous-medium.xhtml",
    probePrepend: true,
  });
  const before = await driver.snapshot();
  const passage = findAnchor(before, "previous-medium-p3");
  expect(passage.visible).toBe(true);
  expect(before.sections.some((section) => section.id === "previous-tall")).toBe(true);
  const cfi = await page.evaluate(() => window.readerFixture.cfi("previous-medium-p3", true));
  const text = await page.evaluate(async (value) => {
    window.readerFixture.highlight(value);
    return window.readerFixture.textAtCfi(value);
  }, cfi);
  expect(text).toContain("Fixture previous-medium, passage 3.");
  for (const height of [4000, 2200, 4600, 1800]) {
    await resizeImage(page, height);
    await assertVisibleAnchorStable(driver, passage);
    expect(await page.evaluate(() => window.readerFixture.cfi("previous-medium-p3", true))).toBe(
      cfi,
    );
    expect(await page.evaluate((value) => window.readerFixture.textAtCfi(value), cfi)).toBe(text);
    await expect(page.locator("#publication .epub-view .epubjs-hl")).toHaveCount(1);
  }
  await driver.attach(testInfo, "late-prior-image", { before, cfi });
});

for (const scale of [1, 1.25, 2]) {
  test(`simultaneous mounted-view changes preserve a passage at ${scale} CSS zoom`, async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "reverse-prepend",
      mode: "continuous",
      profile: "archeion",
      target: "previous-medium.xhtml",
    });
    await page.evaluate((zoom) => {
      document.getElementById("publication")!.style.zoom = String(zoom);
    }, scale);
    await driver.settle();
    const before = await driver.snapshot();
    const passage = findAnchor(before, "previous-medium-p3");
    expect(passage.visible).toBe(true);
    await page.evaluate(() => {
      for (const frame of document.querySelectorAll<HTMLIFrameElement>("#publication iframe")) {
        const doc = frame.contentDocument!;
        if (doc.title === "previous-tall") {
          doc
            .getElementById("previous-tall-image")!
            .style.setProperty("height", "4000px", "important");
          doc
            .getElementById("previous-tall-image")!
            .style.setProperty("max-height", "none", "important");
        }
        if (doc.title === "previous-medium") doc.body.style.paddingTop = "120px";
        if (doc.title === "current") doc.getElementById("current")!.style.minHeight = "4000px";
      }
    });
    await assertVisibleAnchorStable(driver, passage);
    await driver.attach(testInfo, `simultaneous-zoom-${scale}`, { before });
  });
}

test("failed image completion still reconciles geometry without a resize loop", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "previous-medium.xhtml",
  });
  const passage = findAnchor(await driver.snapshot(), "previous-medium-p3");
  await page.evaluate(() => {
    const image = [...document.querySelectorAll<HTMLIFrameElement>("#publication iframe")]
      .map((frame) => frame.contentDocument?.getElementById("previous-tall-image"))
      .find(Boolean) as HTMLImageElement;
    image.src = "data:image/png;base64,broken";
    image.style.setProperty("height", "4000px", "important");
    image.style.setProperty("max-height", "none", "important");
  });
  await assertVisibleAnchorStable(driver, passage);
  const failed = await page.evaluate(() => {
    const image = [...document.querySelectorAll<HTMLIFrameElement>("#publication iframe")]
      .map((frame) => frame.contentDocument?.getElementById("previous-tall-image"))
      .find(Boolean) as HTMLImageElement;
    return { complete: image.complete, naturalWidth: image.naturalWidth };
  });
  expect(failed).toEqual({ complete: true, naturalWidth: 0 });
  const beforeEvents = await page.evaluate(() => window.readerFixture.events().length);
  await driver.settle();
  expect(await page.evaluate(() => window.readerFixture.events().length)).toBe(beforeEvents);
  await driver.attach(testInfo, "failed-image-settle", { failed });
});

test("late image resize inside the visible section uses the passage, not the section delta", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "previous-tall.xhtml#previous-tall-p8",
  });
  const passage = findAnchor(await driver.snapshot(), "previous-tall-p8");
  expect(passage.visible).toBe(true);
  for (const height of [4000, 1800]) {
    await resizeImage(page, height);
    await assertVisibleAnchorStable(driver, passage);
  }
  await driver.attach(testInfo, "late-within-image");
});

test("late changes below the visible passage do not compensate the outer scroller", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "previous-medium.xhtml",
  });
  const before = await driver.snapshot();
  const passage = findAnchor(before, "previous-medium-p3");
  expect(passage.visible).toBe(true);
  for (const padding of [1800, 0]) {
    await page.evaluate((value) => {
      const doc = [...document.querySelectorAll<HTMLIFrameElement>("#publication iframe")]
        .map((frame) => frame.contentDocument)
        .find((candidate) => candidate?.title === "current");
      if (!doc) throw new Error("Following section must already be mounted");
      doc.getElementById("current")!.style.minHeight = `${1800 + value}px`;
    }, padding);
    await assertVisibleAnchorStable(driver, passage);
    expect((await driver.snapshot()).scrollTop).toBe(before.scrollTop);
    const height = (await driver.snapshot()).sections.find(
      (section) => section.id === "current",
    )!.height;
    const initialHeight = before.sections.find((section) => section.id === "current")!.height;
    if (padding > 0) expect(height).toBeGreaterThan(initialHeight);
    else expect(height).toBe(initialHeight);
  }
  await driver.attach(testInfo, "late-below-passage", { before });
});

test("a prepended view that becomes visible does not apply its whole height delta below the passage", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: 2,
  });
  await driver.wheel(-400);
  await driver.settle();
  const before = await driver.snapshot();
  const passage = before.anchors.find(
    (anchor) => anchor.visible && anchor.section === "previous-medium",
  );
  expect(passage).toBeDefined();
  for (const padding of [1800, 0]) {
    await page.evaluate((value) => {
      const doc = [...document.querySelectorAll<HTMLIFrameElement>("#publication iframe")]
        .map((frame) => frame.contentDocument)
        .find((candidate) => candidate?.title === "previous-medium")!;
      doc.getElementById("previous-medium")!.style.minHeight = `${1200 + value}px`;
    }, padding);
    await assertVisibleAnchorStable(driver, passage!);
    expect((await driver.snapshot()).scrollTop).toBe(before.scrollTop);
    const height = (await driver.snapshot()).sections.find(
      (section) => section.id === "previous-medium",
    )!.height;
    const initialHeight = before.sections.find(
      (section) => section.id === "previous-medium",
    )!.height;
    if (padding > 0) expect(height).toBeGreaterThan(initialHeight);
    else expect(height).toBe(initialHeight);
  }
  await driver.attach(testInfo, "visible-prepended-view-below", { before });
});

test("font change in a loaded section preserves the first visible text passage", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "previous-tall.xhtml#previous-tall-p8",
  });
  const before = await driver.snapshot();
  const passage = before.anchors.find((anchor) => anchor.visible && anchor.id.includes("-p"))!;
  expect(passage).toBeDefined();
  await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>("#publication iframe")!.contentDocument!;
    doc.body.style.fontFamily = "monospace";
    doc.body.style.fontSize = "22px";
  });
  await assertVisibleAnchorStable(driver, passage);
  await driver.attach(testInfo, "late-font-change", { before });
});

test("tail shrink preserves the passage while a following section supplies the clamped scroll range", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: 0,
  });
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("#publication iframe")!
      .contentDocument!.getElementById("previous-tall")!.style.minHeight = "8000px";
  });
  await driver.settle();
  await page.evaluate(() => window.readerFixture.display("previous-tall.xhtml#previous-tall-p28"));
  await driver.settle();
  const before = await driver.snapshot();
  const passage = findAnchor(before, "previous-tall-p28");
  expect(passage.visible).toBe(true);
  expect(before.sections.some((section) => section.id === "previous-medium")).toBe(false);
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("#publication iframe")!
      .contentDocument!.getElementById("previous-tall")!.style.minHeight = "3200px";
  });
  await assertVisibleAnchorStable(driver, passage);
  expect(
    (await driver.snapshot()).sections.some((section) => section.id === "previous-medium"),
  ).toBe(true);
  await driver.attach(testInfo, "tail-shrink-clamped-range", { before });
});
