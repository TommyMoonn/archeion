import { expect, test } from "@playwright/test";
import { ReaderRuntimeDriver } from "./reader-runtime-driver";

test.use({
  viewport: { width: 1600, height: 1000 },
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

for (const input of ["wheel", "keyboard", "scrollbar"] as const) {
  test(`first ${input} reaches the next section from a short cover`, async ({ page }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "short-cover",
      mode: "continuous",
      profile: "archeion",
      scrollbar: "visible",
    });
    const before = await driver.snapshot();
    expect(before.atBookEnd).toBe(false);
    if (input === "wheel") await driver.wheel(548);
    else if (input === "keyboard") await driver.key("PageDown");
    else await driver.dragScrollbar(1);
    await driver.settle();
    await driver.attach(testInfo, `first-${input}`, { before });
    expect(
      (await driver.snapshot()).anchors.some(
        (anchor) => anchor.visible && anchor.section !== "cover",
      ),
    ).toBe(true);
  });
}

test("normal scrolling after CFI navigation wakes the following boundary", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "reverse-prepend", mode: "continuous", profile: "archeion" });
  await page.evaluate(() => window.readerFixture.display("previous-tall.xhtml#previous-tall-p20"));
  await driver.settle();
  const before = await driver.snapshot();
  const beforeManager = await page.evaluate(() => window.readerFixture.managerState());
  await driver.wheel(10000);
  await driver.settle();
  await driver.wheel(600);
  await driver.settle();
  await driver.attach(testInfo, "first-scroll-after-cfi", { before, beforeManager });
  expect(
    (await driver.snapshot()).sections.some((section) => section.id === "previous-medium"),
  ).toBe(true);
});

test("late cover shrink prepares continuation before input and without private test checks", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "short-cover", mode: "continuous", profile: "archeion" });
  // Grow beyond the preload range, then shrink to an unscrollable cover. The
  // publication is script-isolated; only the harness changes synthetic geometry.
  await page.evaluate(() => window.readerFixture.changeImageSize(1317));
  await driver.settle();
  const initial = await driver.snapshot();
  await page.evaluate(() => window.readerFixture.changeImageSize(100));
  await driver.settle();
  const settled = await driver.snapshot();
  expect(settled.scrollHeight).toBeLessThan(initial.scrollHeight);
  expect(settled.sections.some((section) => section.id === "continuation")).toBe(true);
  await driver.wheel(548);
  await driver.settle();
  expect(
    (await driver.snapshot()).anchors.some(
      (anchor) => anchor.visible && anchor.section !== "cover",
    ),
  ).toBe(true);
  await driver.attach(testInfo, "cover-shrink-readiness", { initial, settled });
});

test("normal input traverses ten alternating short and long boundaries in both directions", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    probePrepend: true,
    alternatingHeights: true,
  });
  const visibleIndex = async () =>
    (await driver.snapshot()).anchors.find((anchor) => anchor.visible)!.section;
  const visited = new Set<string>();
  for (let step = 0; step < 35 && visited.size < 12; step++) {
    visited.add(await visibleIndex());
    await driver.wheel(650);
    await driver.settle();
  }
  expect(visited.size).toBeGreaterThanOrEqual(12);
  const backward = new Set<string>();
  for (let step = 0; step < 40; step++) {
    backward.add(await visibleIndex());
    await driver.wheel(-650);
    await driver.settle();
    if ((await driver.snapshot()).scrollTop === 0) break;
  }
  expect(backward.size).toBeGreaterThanOrEqual(11);
  const beginning = await driver.snapshot();
  expect(beginning.sections.some((section) => section.height > beginning.clientHeight)).toBe(true);
  expect(beginning.sections.some((section) => section.height < beginning.clientHeight)).toBe(true);
  expect(beginning.scrollTop).toBe(0);
  expect(beginning.preceding).toBeNull();
  const requests = await page.evaluate(() => window.readerFixture.prependProbe().requests());
  expect(new Set(requests).size).toBe(requests.length);
  await driver.wheel(-650);
  await driver.settle();
  expect(await page.evaluate(() => window.readerFixture.prependProbe().requests())).toEqual(
    requests,
  );
  expect((await driver.snapshot()).sections.length).toBeLessThan(42);
  await driver.attach(testInfo, "bidirectional-short-long", {
    visited: [...visited],
    backward: [...backward],
    requests,
  });
});

test("a held following chapter is single-flight through quick reversal and resolves normally", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    probePrepend: true,
  });
  await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest());
  await driver.wheel(1000);
  await expect
    .poll(() => page.evaluate(() => window.readerFixture.prependProbe().waiting()))
    .toBe(true);
  const held = await page.evaluate(() => window.readerFixture.prependProbe().requests());
  for (const delta of [-100, 100, -100, 100]) await driver.wheel(delta);
  expect(await page.evaluate(() => window.readerFixture.prependProbe().requests())).toEqual(held);
  await page.evaluate(() => window.readerFixture.prependProbe().releaseRequest());
  await driver.settle();
  expect(await page.evaluate(() => window.readerFixture.error)).toBeNull();
  const after = await driver.snapshot();
  expect(new Set(after.views.map((view) => view.index)).size).toBe(after.views.length);
  expect(after.anchors.some((anchor) => anchor.visible)).toBe(true);
  await driver.attach(testInfo, "held-following-reversal", { held });
});

for (const direction of ["following", "preceding"] as const) {
  test(`a failed ${direction} chapter stops and permits reopening to retry`, async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    const target = direction === "following" ? 0 : "section-20.xhtml#section-20-p7";
    await driver.open({
      fixture: "long-spine",
      mode: "continuous",
      profile: "archeion",
      probePrepend: true,
      target,
    });
    await page.evaluate(() => window.readerFixture.prependProbe().failNextRequest());
    await driver.attach(testInfo, `before-failed-${direction}`, {
      requests: await page.evaluate(() => window.readerFixture.prependProbe().requests()),
    });
    const beforeFailure = await driver.snapshot();
    await driver.wheel(
      direction === "following" ? beforeFailure.scrollHeight : -beforeFailure.scrollTop - 100,
    );
    await driver.attach(testInfo, `after-failed-${direction}`, {
      requests: await page.evaluate(() => window.readerFixture.prependProbe().requests()),
    });
    await expect.poll(() => page.evaluate(() => window.readerFixture.error)).toBe("open-failed");
    await expect(page.locator("#publication iframe")).toHaveCount(0);
    expect(await page.evaluate(() => window.readerFixture.ready)).toBe(false);
    await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion", target });
    const retry = await driver.snapshot();
    await driver.wheel(direction === "following" ? retry.scrollHeight : -retry.scrollTop - 100);
    await driver.settle();
    expect(await page.evaluate(() => window.readerFixture.error)).toBeNull();
    expect((await driver.snapshot()).anchors.some((anchor) => anchor.visible)).toBe(true);
    await driver.attach(testInfo, `failed-${direction}-retry`);
  });
}

for (const replacement of ["book", "mode", "abort"] as const) {
  test(`pending following load cannot append after ${replacement} replacement`, async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "long-spine",
      mode: "continuous",
      profile: "archeion",
      probePrepend: true,
    });
    await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest());
    await driver.wheel(1000);
    await expect
      .poll(() => page.evaluate(() => window.readerFixture.prependProbe().waiting()))
      .toBe(true);
    if (replacement === "abort") await page.evaluate(() => window.readerFixture.dispose());
    if (replacement === "mode") await page.evaluate(() => window.readerFixture.switchMode("paged"));
    else await driver.open({ fixture: "fixed-layout", profile: "archeion" });
    await driver.settle();
    const before = await driver.snapshot();
    await driver.settle();
    const after = await driver.snapshot();
    expect(after.sections).toEqual(before.sections);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(await page.evaluate(() => window.readerFixture.error)).toBeNull();
    await driver.attach(testInfo, `retired-following-${replacement}`, { before });
  });
}
