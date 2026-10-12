import { expect, test } from "@playwright/test";
import { ReaderRuntimeDriver, assertNoBlankReverse, findAnchor } from "./reader-runtime-driver";
import type { PrependCorrection } from "./fixtures/reader-prepend-probe";

function prependCompensation(corrections: PrependCorrection[], since: number, validate = true) {
  let insertedHeight = 0;
  let expectedShift = 0;
  for (const correction of corrections.filter((entry) => entry.before.time >= since)) {
    const applied = correction.after.scrollTop - correction.before.scrollTop;
    if (correction.source === "counter") {
      // Ignored mounted-view resizes belong to the anchor owner, not counter.
      if (applied === 0) continue;
      if (validate) expect(Math.abs(applied - correction.requestedY)).toBeLessThanOrEqual(2);
      insertedHeight += Math.max(0, correction.requestedY);
      expectedShift += correction.requestedY;
    } else if (correction.source === "scrollBy") {
      expectedShift += correction.requestedY;
    } else if (correction.source === "erase") {
      // Include native clamping during removal, before vendor scrollTo runs.
      if (validate) expect(Math.abs(applied - correction.requestedY)).toBeLessThanOrEqual(2);
      expectedShift += correction.requestedY;
    } else {
      // Stock erase compensates above removal through an absolute scrollTo.
      expectedShift += correction.requestedY - correction.before.scrollTop;
    }
  }
  return { insertedHeight, expectedShift };
}

test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  // Fit every measured stage and its full scrollbar track inside the browser.
  viewport: { width: 1600, height: 1000 },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") return route.abort();
    return route.continue();
  });
});

for (const profile of ["stock", "archeion"] as const) {
  for (const anchoring of ["auto", "none"] as const) {
    test(`prepend anchoring A/B: ${profile}, ${anchoring}`, async ({ page }, testInfo) => {
      const driver = new ReaderRuntimeDriver(page);
      await driver.open({
        fixture: "reverse-prepend",
        mode: "continuous",
        profile,
        target: 2,
        anchoring,
        probePrepend: true,
      });
      const events = await page.evaluate(() => window.readerFixture.events());
      const before = events.find(
        (event) => event.type === "rendered" && event.section === "current",
      )!.snapshot;
      const after = await driver.snapshot();
      const addedHeight = after.views
        .filter((view) => view.index < 2)
        .reduce((sum, view) => sum + view.height, 0);
      const anchor = findAnchor(before, "current-p3");
      const error = findAnchor(after, anchor.id).top - anchor.top;
      await driver.attach(testInfo, `prepend-${profile}-${anchoring}`, {
        before,
        addedHeight,
        error,
        corrections: await page.evaluate(() => window.readerFixture.prependProbe().corrections()),
      });
      console.log(
        JSON.stringify({
          profile,
          anchoring,
          addedHeight,
          correction: after.scrollTop - before.scrollTop,
          error,
        }),
      );
      expect(addedHeight).toBeGreaterThan(0);
      if (anchoring === "none") expect(Math.abs(error)).toBeLessThanOrEqual(2);
      else expect(Math.abs(error)).toBeGreaterThan(2);

      await driver.open({
        fixture: "reverse-prepend",
        mode: "continuous",
        profile,
        target: "current.xhtml#current-p18",
        anchoring,
        probePrepend: true,
      });
      const nearTop = await page.evaluate(() => window.readerFixture.prependProbe().atOffset(40));
      const passage = nearTop.anchors.find((candidate) => candidate.visible)!;
      expect(nearTop.scrollTop).toBe(40);
      await driver.settle();
      const settled = await driver.snapshot();
      const visibleError = findAnchor(settled, passage.id).top - passage.top;
      const corrections = await page.evaluate(() =>
        window.readerFixture.prependProbe().corrections(),
      );
      const { insertedHeight: inserted } = prependCompensation(
        corrections,
        nearTop.time,
        anchoring === "none",
      );
      await driver.attach(testInfo, `near-40-${profile}-${anchoring}`, {
        before: nearTop,
        after: settled,
        inserted,
        visibleError,
        corrections,
      });
      console.log(
        JSON.stringify({
          profile,
          anchoring,
          offset: 40,
          inserted,
          correction: settled.scrollTop - nearTop.scrollTop,
          visibleError,
        }),
      );
      expect(inserted).toBeGreaterThan(0);
      if (anchoring === "none") expect(Math.abs(visibleError)).toBeLessThanOrEqual(2);
      else expect(Math.abs(visibleError)).toBeGreaterThan(2);
    });
  }
}

for (const width of [900, 1050, 1400]) {
  test(`owned prepend retains CFI passage at ${width}px`, async ({ page }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "reverse-prepend",
      mode: "continuous",
      profile: "archeion",
      target: 2,
      width,
      probePrepend: true,
    });
    const events = await page.evaluate(() => window.readerFixture.events());
    const before = events.find(
      (event) => event.type === "rendered" && event.section === "current",
    )!.snapshot;
    const after = await driver.snapshot();
    const anchor = findAnchor(before, "current-p3");
    expect(findAnchor(after, anchor.id).visible).toBe(true);
    expect(Math.abs(findAnchor(after, anchor.id).top - anchor.top)).toBeLessThanOrEqual(2);
    const cfi = await page.evaluate(() => window.readerFixture.cfi("current-p3"));
    expect(cfi).toMatch(/^epubcfi\(/);
    await page.evaluate((target) => window.readerFixture.display(target), cfi);
    await driver.settle();
    expect(findAnchor(await driver.snapshot(), "current-p3").visible).toBe(true);
    // Anchoring is changed on one outer surface, never on publication documents.
    const scope = await page.evaluate(() => ({
      outer: getComputedStyle(document.querySelector("#publication .epub-container")!)
        .overflowAnchor,
      root: getComputedStyle(document.documentElement).overflowAnchor,
      body: getComputedStyle(document.body).overflowAnchor,
      frames: [...document.querySelectorAll<HTMLIFrameElement>("#publication iframe")].map(
        (frame) => [
          frame.contentWindow!.getComputedStyle(frame.contentDocument!.documentElement)
            .overflowAnchor,
          frame.contentWindow!.getComputedStyle(frame.contentDocument!.body).overflowAnchor,
        ],
      ),
    }));
    expect(scope.outer).toBe("none");
    expect(scope.root).toBe("auto");
    expect(scope.body).toBe("auto");
    expect(scope.frames.every((values) => values.every((value) => value === "auto"))).toBe(true);
    await driver.attach(testInfo, `owned-${width}`, {
      before,
      after,
      cfi,
      scope,
      corrections: await page.evaluate(() => window.readerFixture.prependProbe().corrections()),
    });

    await driver.open({
      fixture: "long-spine",
      mode: "continuous",
      profile: "archeion",
      target: "section-21.xhtml#long-media",
      width,
      probePrepend: true,
    });
    const imageOpen = await driver.snapshot();
    expect(findAnchor(imageOpen, "long-media").visible).toBe(true);
    // Request one more preceding view while the illustration is visible. The
    // diagnostic preload horizon is not the ordinary boundary-wakeup contract.
    const imageBefore = await page.evaluate(
      (offset) => window.readerFixture.prependProbe().atOffset(offset, offset + 1),
      imageOpen.scrollTop,
    );
    const image = findAnchor(imageBefore, "long-media");
    expect(image.visible).toBe(true);
    await driver.settle();
    const imageAfter = await driver.snapshot();
    expect(findAnchor(imageAfter, image.id).visible).toBe(true);
    expect(Math.abs(findAnchor(imageAfter, image.id).top - image.top)).toBeLessThanOrEqual(2);
    const corrections = await page.evaluate(() =>
      window.readerFixture.prependProbe().corrections(),
    );
    const { insertedHeight: newHeight, expectedShift } = prependCompensation(
      corrections,
      imageBefore.time,
    );
    expect(newHeight).toBeGreaterThan(0);
    expect(
      Math.abs(imageAfter.scrollTop - imageBefore.scrollTop - expectedShift),
    ).toBeLessThanOrEqual(2);
    await driver.attach(testInfo, `owned-image-${width}`, {
      before: imageBefore,
      after: imageAfter,
      newHeight,
      corrections,
    });
  });
}

for (const offset of [40, 140, 300]) {
  test(`successive prepends preserve near-top passage at offset ${offset}`, async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "reverse-prepend",
      mode: "continuous",
      profile: "archeion",
      target: "current.xhtml#current-p18",
      probePrepend: true,
    });
    expect((await driver.snapshot()).views.every((view) => view.index >= 2)).toBe(true);
    const before = await page.evaluate(
      (y) => window.readerFixture.prependProbe().atOffset(y),
      offset,
    );
    const anchor = before.anchors.find((candidate) => candidate.visible)!;
    expect(anchor).toBeDefined();
    expect(before.scrollTop).toBe(offset);
    await driver.settle();
    const after = await driver.snapshot();
    const corrections = await page.evaluate(() =>
      window.readerFixture.prependProbe().corrections(),
    );
    const { insertedHeight: addedHeight, expectedShift } = prependCompensation(
      corrections,
      before.time,
    );
    expect(addedHeight).toBeGreaterThan(0);
    expect(Math.abs(after.scrollTop - before.scrollTop - expectedShift)).toBeLessThanOrEqual(2);
    expect(findAnchor(after, anchor.id).visible).toBe(true);
    expect(Math.abs(findAnchor(after, anchor.id).top - anchor.top)).toBeLessThanOrEqual(2);
    await driver.attach(testInfo, `near-top-${offset}`, {
      before,
      after,
      addedHeight,
      corrections,
    });
    const counters = corrections.filter((correction) => correction.source === "counter");
    expect(counters.length).toBeGreaterThanOrEqual(2);
    for (const correction of counters) {
      const applied = correction.after.scrollTop - correction.before.scrollTop;
      // Initial mounts retain vendor compensation. A later resize of a mounted
      // view delegates to the visible-anchor owner and does not add its full delta.
      if (applied !== 0) expect(Math.abs(applied - correction.requestedY)).toBeLessThanOrEqual(2);
    }
    for (const correction of corrections.filter(
      (entry) => entry.source === "scrollBy" && entry.before.time >= before.time,
    )) {
      expect(
        Math.abs(correction.after.scrollTop - correction.before.scrollTop - correction.requestedY),
      ).toBeLessThanOrEqual(2);
    }
  });
}

test("a ready preceding section is shown while the next neighbor request is held", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    target: "section-37.xhtml#section-37-p7",
    alternatingHeights: true,
    probePrepend: true,
  });
  const initial = await driver.snapshot();
  const precedingIndex = Math.min(...initial.views.map((view) => view.index)) - 1;
  const section = `section-${String(precedingIndex + 1).padStart(2, "0")}`;
  // The short previous section completes; the subsequent tall neighbor remains
  // pending inside the vendor's recursive check. No private check is invoked.
  await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest(1));
  await driver.wheel(-2000);
  try {
    await expect
      .poll(async () => {
        const waiting = await page.evaluate(() => window.readerFixture.prependProbe().waiting());
        if (!waiting) await driver.wheel(-600);
        return waiting;
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await driver.snapshot()).readiness.find((view) => view.index === precedingIndex)
            ?.displayed,
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          (section) =>
            window.readerFixture
              .events()
              .some((event) => event.type === "rendered" && event.section === section),
          section,
        ),
      )
      .toBe(true);
    const ready = await driver.snapshot();
    await driver.attach(testInfo, "preceding-ready-before-wheel", { ready, section });
    expect(ready.readiness.find((view) => view.index === precedingIndex)?.visibility).toBe(
      "visible",
    );
    // Target the measured passage using real input; a fixed delta can leave the
    // first line above the viewport after publisher height reconciliation.
    await driver.wheel(findAnchor(ready, `${section}-p1`).top - ready.viewportTop - 100);
    await expect
      .poll(async () => findAnchor(await driver.snapshot(), `${section}-p1`).visible)
      .toBe(true);
    const sample = await driver.snapshot();
    const view = sample.readiness.find((view) => view.index === precedingIndex)!;
    expect(view.readyState).toBe("complete");
    expect(view.visibility).toBe("visible");
    expect(view.hit).toBe(true);
    expect(await page.evaluate(() => window.readerFixture.prependProbe().waiting())).toBe(true);
    await driver.attach(testInfo, "ready-view-held-neighbor", { sample });
  } finally {
    await page.evaluate(() => window.readerFixture.prependProbe().releaseRequest());
  }
  await driver.settle();
});

test("reverse input crosses ten boundaries without downward passage snap", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "long-spine",
    mode: "continuous",
    profile: "archeion",
    target: "section-37.xhtml#section-37-p7",
    scrollbar: "visible",
    probePrepend: true,
    // Test-only comparison against the removed wheel path when a traversal fails.
    legacyWheelForwarding: process.env.ARCHEION_READER_LEGACY_WHEEL === "1",
  });
  const start = await driver.snapshot();
  const samples = [start];
  for (let step = 0; step < 24; step += 1) {
    const before = await driver.snapshot();
    const passage = before.anchors.find((anchor) => anchor.visible)!;
    expect(passage).toBeDefined();
    const action =
      step % 6 === 0
        ? () => page.evaluate(() => window.readerFixture.turn("prev"))
        : () => driver.wheel(-450);
    const frames = await driver.sampleFrames(action);
    assertNoBlankReverse(frames);
    let previousY = passage.top;
    for (const frame of frames) {
      const y = findAnchor(frame, passage.id).top;
      expect(y).toBeGreaterThanOrEqual(previousY - 2);
      previousY = y;
    }
    await driver.settle();
    const after = await driver.snapshot();
    expect(findAnchor(after, passage.id).top).toBeGreaterThan(passage.top);
    samples.push(after);
  }
  const beforeDrag = await driver.snapshot();
  const passage = beforeDrag.anchors.find((anchor) => anchor.visible)!;
  const reverseFraction =
    (beforeDrag.scrollTop / Math.max(1, beforeDrag.scrollHeight - beforeDrag.clientHeight)) * 0.25;
  const dragFrames = await driver.sampleFrames(() => driver.dragScrollbar(reverseFraction));
  await driver.attach(testInfo, "scrollbar-reverse-frames", { beforeDrag, frames: dragFrames });
  assertNoBlankReverse(dragFrames);
  await driver.settle();
  expect(findAnchor(await driver.snapshot(), passage.id).top).toBeGreaterThan(passage.top);
  const after = await driver.snapshot();
  expect(
    start.sections.find(
      (section) =>
        section.top <= start.viewportTop + 2 && section.top + section.height > start.viewportTop,
    )!.index -
      after.sections.find(
        (section) =>
          section.top <= after.viewportTop + 2 && section.top + section.height > after.viewportTop,
      )!.index,
  ).toBeGreaterThanOrEqual(10);
  assertNoBlankReverse(samples);
  await driver.attach(testInfo, "ten-boundary-reverse", {
    start,
    samples,
    corrections: await page.evaluate(() => window.readerFixture.prependProbe().corrections()),
  });
});

test("reverse command during a pending prepend retains the latest passage intent", async ({
  page,
}, testInfo) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({
    fixture: "reverse-prepend",
    mode: "continuous",
    profile: "archeion",
    target: "current.xhtml#current-p18",
    probePrepend: true,
  });
  await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest());
  const pending = page.evaluate(() => window.readerFixture.prependProbe().atOffset(40));
  await expect
    .poll(() => page.evaluate(() => window.readerFixture.prependProbe().waiting()))
    .toBe(true);
  const beforeReverse = await driver.snapshot();
  const passage = beforeReverse.anchors.find((anchor) => anchor.visible)!;
  await driver.wheel(-20);
  await page.evaluate(() => window.readerFixture.prependProbe().releaseRequest());
  await pending;
  await driver.settle();
  const after = await driver.snapshot();
  expect(findAnchor(after, passage.id).visible).toBe(true);
  expect(Math.abs(findAnchor(after, passage.id).top - passage.top - 20)).toBeLessThanOrEqual(2);
  await driver.attach(testInfo, "pending-reverse", {
    beforeReverse,
    after,
    corrections: await page.evaluate(() => window.readerFixture.prependProbe().corrections()),
  });
});

for (const retirement of ["book switch", "abort"] as const) {
  test(`${retirement} of a pending prepend cannot move the replacement session`, async ({
    page,
  }, testInfo) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({
      fixture: "reverse-prepend",
      mode: "continuous",
      profile: "archeion",
      target: "current.xhtml#current-p18",
      probePrepend: true,
    });
    await page.evaluate(() => window.readerFixture.prependProbe().holdNextRequest());
    const pending = page
      .evaluate(() => window.readerFixture.prependProbe().atOffset(40))
      .catch((error: Error) => error.message);
    await expect
      .poll(() => page.evaluate(() => window.readerFixture.prependProbe().waiting()))
      .toBe(true);
    if (retirement === "abort") await page.evaluate(() => window.readerFixture.dispose());
    await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
    const before = await driver.snapshot();
    const passage = before.anchors.find((anchor) => anchor.visible)!;
    const retiredResult = await pending;
    await driver.settle();
    const after = await driver.snapshot();
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(findAnchor(after, passage.id).top).toBe(findAnchor(before, passage.id).top);
    expect(after.sections.every((section) => section.id.startsWith("section-"))).toBe(true);
    await driver.attach(testInfo, "retired-prepend", { before, after, retiredResult });
    await driver.wheel(-450);
    await driver.settle();
    expect((await driver.snapshot()).scrollTop).toBe(0);
    expect((await driver.snapshot()).views.filter((view) => view.index === 0)).toHaveLength(1);
  });
}
