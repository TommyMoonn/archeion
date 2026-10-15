import { expect, test } from "@playwright/test";
import {
  ReaderRuntimeDriver,
  assertImageCentered,
  assertNextSectionReachable,
  assertNoBlankReverse,
  assertSectionResidencyBounded,
  assertVisibleAnchorStable,
  findAnchor,
} from "./reader-runtime-driver";

// Headless Chromium normally hides native scrollbars, which prevents real drag input.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") return route.abort();
    return route.continue();
  });
});

test("newer fixture open supersedes pending generation", async ({ page }) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "nested-prose" });
  await page.evaluate(async () => {
    await Promise.all([
      window.readerFixture.open({ fixture: "long-spine", mode: "continuous" }),
      window.readerFixture.open({ fixture: "fixed-layout" }),
    ]);
  });
  expect(await page.evaluate(() => window.readerFixture.layout)).toBe("fixed-layout");
  expect((await driver.snapshot()).sections.map((section) => section.id)).toEqual(["page-one"]);
});

test("rejected EPUB open disposes the attempt and permits recovery", async ({ page }, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "nested-prose", mode: "continuous", profile: "archeion" });
  const failure = await page.evaluate(async () => {
    const previousFrame = document.querySelector("#publication iframe");
    let error = "";
    try {
      // A supported display target that cannot resolve in this real Book's spine.
      await window.readerFixture.open({
        fixture: "reverse-prepend",
        mode: "continuous",
        profile: "archeion",
        target: "missing-fixture-section.xhtml",
      });
    } catch (caught) {
      error = String(caught);
    }
    let sessionError = "";
    try {
      window.readerFixture.snapshot();
    } catch (caught) {
      sessionError = String(caught);
    }
    return {
      error,
      sessionError,
      ready: window.readerFixture.ready,
      previousFrameConnected: previousFrame?.isConnected,
    };
  });
  expect(failure.error).toBe("Error: No Section Found");
  expect(failure.sessionError).toBe("Error: Open a fixture first");
  expect(failure.ready).toBe(false);
  expect(failure.previousFrameConnected).toBe(false);
  await expect(page.locator("#publication iframe")).toHaveCount(0);
  await expect(page.locator("#publication .epub-container")).toHaveCount(0);
  await driver.open({ fixture: "fixed-layout", profile: "archeion" });
  expect(await page.evaluate(() => window.readerFixture.ready)).toBe(true);
  const recovery = await driver.snapshot();
  expect(recovery.sections.map((section) => section.id)).toEqual(["page-one"]);
  expect(findAnchor(recovery, "page-one-anchor").visible).toBe(true);
  const evidence = await driver.attach(testInfo, "failed-open-recovery", { failure });
  expect(
    evidence.events.filter((event) => event.type === "rendered").map((event) => event.section),
  ).toEqual(["page-one"]);
});

test("real renderer observes resume, CFI, mode switch, geometry events and teardown", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "reverse-prepend", mode: "continuous", target: 2 });
  const initial = await driver.snapshot();
  expect(initial.sections.some((section) => section.id === "current")).toBe(true);
  const cfi = await page.evaluate(() => window.readerFixture.cfi("current-p3"));
  expect(cfi).toMatch(/^epubcfi\(/);
  await page.evaluate((target) => window.readerFixture.display(target), cfi);
  await driver.settle();
  const anchor = findAnchor(await driver.snapshot(), "current-p3");
  expect(anchor.visible).toBe(true);
  await assertVisibleAnchorStable(driver, anchor);
  await page.evaluate(() => window.readerFixture.switchMode("paged"));
  await driver.settle();
  expect(await page.evaluate(() => window.readerFixture.mode)).toBe("paged");
  expect(findAnchor(await driver.snapshot(), "current-p3").visible).toBe(true);
  const evidence = await driver.attach(testInfo, "resume-mode-events");
  expect(evidence.events.some((event) => event.type === "rendered")).toBe(true);
  expect(evidence.events.some((event) => event.type === "relocated")).toBe(true);
  await page.evaluate(() => window.readerFixture.dispose());
  await expect(page.locator("#publication iframe")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Continuous input uses iframe wheel, PageDown/PageUp and actual scrollbar drag", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: 0,
    scrollbar: "visible",
  });
  const initial = await driver.snapshot();
  await driver.wheel(95);
  await expect
    .poll(async () => (await driver.snapshot()).scrollTop)
    .toBeGreaterThan(initial.scrollTop);
  await driver.settle();
  const afterWheel = await driver.snapshot();
  await driver.key("PageDown");
  await driver.settle();
  const afterDown = await driver.snapshot();
  expect(afterDown.scrollTop).toBeGreaterThan(afterWheel.scrollTop);
  await driver.key("PageUp");
  await driver.settle();
  expect((await driver.snapshot()).scrollTop).toBeLessThan(afterDown.scrollTop);
  await driver.dragScrollbar(0.6);
  await driver.settle();
  expect((await driver.snapshot()).scrollTop).toBeGreaterThan(afterDown.scrollTop);
  const evidence = await driver.attach(testInfo, "input-paths");
  expect(evidence.events.some((event) => event.type === "iframe-wheel" && !event.cancelled)).toBe(
    true,
  );
});

test("normal chapter traversal and repeated reversal distinguish true EOF", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
  expect((await driver.snapshot()).preceding).toBeNull();
  await driver.wheel(-95);
  await driver.settle();
  expect((await driver.snapshot()).scrollTop).toBe(0);
  const samples = [await driver.snapshot()];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await driver.wheel(450);
    await driver.settle();
    const beforeReverse = await driver.snapshot();
    samples.push(beforeReverse);
    const passage = beforeReverse.anchors.find((anchor) => anchor.visible);
    expect(passage, "A visible authored passage before upward input").toBeDefined();
    const reverseFrames = await driver.sampleFrames(() => driver.wheel(-200));
    assertNoBlankReverse(reverseFrames);
    await driver.settle();
    const afterReverse = await driver.snapshot();
    samples.push(afterReverse);
    // Earlier reading moves the same passage down on screen. Prepend compensation
    // can increase raw scrollTop, so assert effective motion in authored coordinates.
    expect(
      findAnchor(afterReverse, passage!.id).top,
      "Upward input effectively reverses reading position, not just retains content",
    ).toBeGreaterThan(passage!.top);
  }
  assertNoBlankReverse(samples);
  await assertNextSectionReachable(driver, "section-02");
  await page.evaluate(() => window.readerFixture.display(41));
  await driver.settle();
  await driver.key("End");
  await driver.settle();
  const end = await driver.snapshot();
  expect(end.atBookEnd).toBe(true);
  expect(end.following).toBeNull();
  await driver.wheel(600);
  await driver.settle();
  expect((await driver.snapshot()).scrollTop).toBe(end.scrollTop);
  await driver.attach(testInfo, "traversal-and-true-eof", { samples });
});

test("Paged image fallback and fixed-layout composition remain usable", async ({ page }) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "image-only", mode: "paged", profile: "archeion" });
  await assertImageCentered(driver, "isolated-image");
  const pagedSamples = [await driver.snapshot()];
  await page.evaluate(() => window.readerFixture.turn("next"));
  await driver.settle();
  pagedSamples.push(await driver.snapshot());
  assertSectionResidencyBounded(pagedSamples, 1);
  expect((await driver.snapshot()).sections.some((section) => section.id === "composition")).toBe(
    true,
  );
  await driver.open({ fixture: "fixed-layout", mode: "continuous", profile: "archeion" });
  expect(await page.evaluate(() => window.readerFixture.mode)).toBe("paged");
  const frame = page.frameLocator("#publication iframe");
  await expect(frame.locator(".page-label")).toHaveCSS("left", "370px");
  await expect(frame.locator(".page-label")).toHaveCSS("position", "absolute");
  await frame.getByRole("link", { name: "Continue to page two" }).click();
  await expect(frame.locator("#page-two-anchor")).toBeVisible();
});

test.describe("opt-in historical diagnostics", () => {
  test.skip(
    process.env.ARCHEION_READER_DIAGNOSTICS !== "1",
    "Set ARCHEION_READER_DIAGNOSTICS=1 to reproduce unfixed contracts",
  );

  test("short-cover false boundary retains an available next spine section", async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({ fixture: "short-cover", mode: "continuous" });
    const initial = await driver.snapshot();
    await page.evaluate(() => window.readerFixture.changeImageSize());
    await driver.settle();
    const settled = await driver.snapshot();
    await driver.wheel(548);
    await driver.settle();
    const first = await driver.snapshot();
    await driver.wheel(630);
    await driver.settle();
    const second = await driver.snapshot();
    const evidence = await driver.attach(testInfo, "RDR-01-false-boundary", {
      initial,
      settled,
      first,
      second,
    });
    console.log(
      "RDR-01",
      JSON.stringify({
        initial: initial.scrollHeight,
        settled: settled.scrollHeight,
        first: first.scrollTop,
        second: second.scrollTop,
        sections: evidence.snapshot.sections.map((section) => section.id),
        following: second.following,
        atBookEnd: second.atBookEnd,
      }),
    );
    expect(second.atBookEnd).toBe(false);
    expect(settled.scrollHeight).toBeLessThan(initial.scrollHeight);
    expect(second.following).toBe("short-first");
    test.fail(true, "RDR-01: stock epub.js has no Archeion boundary reconciliation");
    await assertNextSectionReachable(driver, "short-first");
  });

  for (const profile of ["stock"] as const) {
    test(`reverse-prepend keeps visible passage with ${profile} integration`, async ({
      page,
    }, testInfo) => {
      const driver = new ReaderRuntimeDriver(page);
      await driver.open({ fixture: "reverse-prepend", mode: "continuous", profile, target: 2 });
      const events = await page.evaluate(() => window.readerFixture.events());
      // display(2) itself prepends neighboring entries. Capture the passage
      // before insertion rather than moving into an already retired view.
      const before = events.find(
        (event) => event.type === "rendered" && event.section === "current",
      )!.snapshot;
      const anchor = findAnchor(before, "current-p3");
      expect(anchor.visible).toBe(true);
      const after = await driver.snapshot();
      const addedHeight = after.views
        .filter((section) => section.index < 2)
        .reduce(
          (sum, section) =>
            sum + section.height - (before.views.find((old) => old.id === section.id)?.height ?? 0),
          0,
        );
      const prependMounts = events.filter(
        (event) =>
          event.type === "rendered" &&
          ["previous-medium", "previous-tall"].includes(event.section ?? ""),
      );
      const afterAnchor = findAnchor(after, anchor.id);
      const trace = {
        before,
        after,
        addedHeight,
        prependMounts,
        requiredOffset: before.scrollTop + addedHeight,
        actualOffset: after.scrollTop,
        visibleError: afterAnchor.top - anchor.top,
      };
      await driver.attach(testInfo, `RDR-10-${profile}`, trace);
      console.log(
        "RDR-10",
        profile,
        JSON.stringify({
          addedHeight,
          requiredOffset: trace.requiredOffset,
          actualOffset: trace.actualOffset,
          visibleError: trace.visibleError,
        }),
      );
      expect(addedHeight).toBeGreaterThan(0);
      test.fail(true, "RDR-10: position ownership belongs to phase 1.7.0.4");
      await assertVisibleAnchorStable(driver, anchor);
    });
  }
});
