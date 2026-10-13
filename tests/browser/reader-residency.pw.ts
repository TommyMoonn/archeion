import { expect, test } from "@playwright/test";
import {
  ReaderRuntimeDriver,
  assertNoBlankReverse,
  assertVisibleAnchorStable,
} from "./reader-runtime-driver";
import type { RuntimeSnapshot } from "./fixtures/reader-runtime-observer";

test.use({
  viewport: { width: 1600, height: 1000 },
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

test("long traversal retires offscreen frames and reverses through evicted sections", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    scrollbar: "visible",
  });
  const samples: RuntimeSnapshot[] = [];
  const earlyCfi = await page.evaluate(() => window.readerFixture.cfi("section-01-anchor"));
  const visited = new Set<number>();
  for (let step = 0; step < 150; step++) {
    const sample = await driver.snapshot();
    samples.push(sample);
    const listeners = await page.evaluate(() => window.readerFixture.residency());
    expect(listeners.registeredDocuments).toBeLessThanOrEqual(sample.viewCount);
    expect(listeners.observerDocuments).toBeLessThanOrEqual(sample.viewCount);
    expect(listeners.observerViews).toBeLessThanOrEqual(sample.viewCount);
    for (const view of sample.readiness)
      if (view.inViewport && view.displayed) visited.add(view.index);
    if (sample.atBookEnd) break;
    await driver.wheel(600);
    await driver.settle();
  }
  expect(visited.size).toBeGreaterThanOrEqual(40);
  expect(samples.at(-1)!.atBookEnd).toBe(true);
  const counts = samples.map((sample) => sample.viewCount);
  console.log(
    JSON.stringify({
      profile: process.env.ARCHEION_RESIDENCY_BASELINE ?? "bounded",
      visited: visited.size,
      counts,
    }),
  );
  await testInfo.attach("residency-traversal", {
    body: JSON.stringify({ visited: [...visited], samples }),
    contentType: "application/json",
  });
  if (process.env.ARCHEION_RESIDENCY_BASELINE) {
    expect(counts.at(-1)).toBeGreaterThanOrEqual(40);
    return;
  }
  const minimumHeight = Math.min(
    ...samples
      .flatMap((sample) => sample.sections.map((section) => section.height))
      .filter((height) => height > 0),
  );
  // Six viewport heights plus intersecting edge chapters, measured from this EPUB.
  const frameBound = Math.ceil((6 * samples[0].clientHeight) / minimumHeight) + 2;
  expect(Math.max(...counts)).toBeLessThanOrEqual(frameBound);
  expect((await driver.snapshot()).sections.some((section) => section.index === 0)).toBe(false);
  assertNoBlankReverse(
    await driver.sampleFrames(() =>
      page.evaluate((cfi) => window.readerFixture.display(cfi), earlyCfi),
    ),
  );
  await driver.settle();
  expect(
    (await driver.snapshot()).anchors.some(
      (anchor) => anchor.id === "section-01-anchor" && anchor.visible,
    ),
  ).toBe(true);
  await page.evaluate(() => window.readerFixture.display(41));
  await driver.settle();
  for (let step = 0; step < 60; step++) {
    assertNoBlankReverse(await driver.sampleFrames(() => driver.wheel(-600)));
    await driver.settle();
    const sample = await driver.snapshot();
    expect(sample.viewCount).toBeLessThanOrEqual(frameBound);
    const listeners = await page.evaluate(() => window.readerFixture.residency());
    expect(listeners.registeredDocuments).toBeLessThanOrEqual(sample.viewCount);
    expect(listeners.observerDocuments).toBeLessThanOrEqual(sample.viewCount);
    expect(listeners.observerViews).toBeLessThanOrEqual(sample.viewCount);
    expect(sample.anchors.some((anchor) => anchor.visible)).toBe(true);
    if (step % 10 === 5) {
      assertNoBlankReverse(await driver.sampleFrames(() => driver.wheel(600)));
      await driver.settle();
      assertNoBlankReverse(await driver.sampleFrames(() => driver.wheel(-600)));
      await driver.settle();
    }
    if (sample.preceding === null && sample.scrollTop === 0) break;
  }
  expect((await driver.snapshot()).preceding).toBeNull();
  await driver.attach(testInfo, "residency-reversal");
});

test("warm window handles tiny chapters, bursts, PageUp, scrollbar seek and resize during loading", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    alternatingHeights: true,
    target: "section-30.xhtml#section-30-p7",
    scrollbar: "visible",
    probePrepend: true,
  });
  for (const delta of [-900, 700, -900, 700, -900]) {
    const frames = await driver.sampleFrames(() => driver.wheel(delta));
    await testInfo.attach(`burst-${delta}`, {
      body: JSON.stringify(frames),
      contentType: "application/json",
    });
    console.log(
      JSON.stringify({
        action: `burst-${delta}`,
        blank: frames
          .filter((frame) => !frame.anchors.some((anchor) => anchor.visible))
          .map((frame) => ({
            scrollTop: frame.scrollTop,
            views: frame.views,
            readiness: frame.readiness,
          })),
      }),
    );
    assertNoBlankReverse(frames);
    await driver.settle();
  }
  const keyFrames = await driver.sampleFrames(() => driver.key("PageUp"));
  await testInfo.attach("page-up", {
    body: JSON.stringify(keyFrames),
    contentType: "application/json",
  });
  assertNoBlankReverse(keyFrames);
  await driver.settle();
  const dragFrames = await driver.sampleFrames(() => driver.dragScrollbar(0));
  await testInfo.attach("scrollbar-seek", {
    body: JSON.stringify(dragFrames),
    contentType: "application/json",
  });
  assertNoBlankReverse(dragFrames);
  await driver.settle();
  const before = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("#publication .epub-container")!;
    scroller.scrollTop = Math.min(
      scroller.scrollTop + 900,
      scroller.scrollHeight - scroller.clientHeight,
    );
    scroller.dispatchEvent(new Event("scroll"));
    return window.readerFixture.snapshot();
  });
  const anchor = before.anchors.find((candidate) => candidate.visible)!;
  await assertVisibleAnchorStable(driver, anchor);
  await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest());
  await expect
    .poll(async () => {
      const waiting = await page.evaluate(() => window.readerFixture.prependProbe().waiting());
      if (!waiting) await driver.wheel(10000);
      return waiting;
    })
    .toBe(true);
  await page.evaluate(() => {
    window.readerFixture.resize(900, 700);
    window.readerFixture.prependProbe().releaseRequest();
  });
  await driver.settle();
  const after = await driver.snapshot();
  expect(after.anchors.some((candidate) => candidate.visible)).toBe(true);
  expect(new Set(after.views.map((view) => view.index)).size).toBe(after.views.length);
  await driver.attach(testInfo, "mixed-residency-input", {
    before,
    after,
    listeners: await page.evaluate(() => window.readerFixture.residency()),
  });
});

test("a huge image chapter is warm only while needed and is released after navigation", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: 0,
  });
  await page.evaluate(() => window.readerFixture.changeImageSize(15000));
  await driver.settle();
  const large = await driver.snapshot();
  expect(large.sections.some((section) => section.height > large.clientHeight * 10)).toBe(true);
  const oldFrame = await page.locator("#publication iframe").first().elementHandle();
  await page.evaluate(() => window.readerFixture.display("following.xhtml#following-p3"));
  await driver.settle();
  expect(await oldFrame!.evaluate((frame) => frame.isConnected)).toBe(false);
  expect((await driver.snapshot()).anchors.some((anchor) => anchor.visible)).toBe(true);
  await driver.attach(testInfo, "huge-image-retirement", { large });
});
