import { expect } from "@playwright/test";
import { test, ReaderRuntimeDriver } from "./reader-runtime-driver";

test("compact frames agree with full blank-content, hit-test and residency observations", async ({
  page,
}, info) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion", target: 20 });
  const compare = () =>
    page.evaluate(() => {
      const full = window.readerFixture.snapshot();
      const tracked = full.anchors.find((anchor) => anchor.visible);
      const compact = window.readerFixture.sampleFrame(tracked ? [tracked.id] : []);
      return {
        fullVisible: full.anchors.some((anchor) => anchor.visible),
        compactVisible: compact.authoredContentVisible,
        fullReadiness: full.readiness,
        compactReadiness: compact.readiness,
        fullSections: full.sections,
        compactSections: compact.sections,
        fullCount: full.viewCount,
        compactCount: compact.viewCount,
        tracked,
        compactAnchors: compact.anchors,
      };
    });
  const check = async (visible: boolean, hit: boolean) => {
    const result = await compare();
    expect(result.compactVisible).toBe(result.fullVisible);
    expect(result.compactVisible).toBe(visible);
    expect(result.compactReadiness).toEqual(result.fullReadiness);
    expect(result.compactReadiness.some((view) => view.hit)).toBe(hit);
    expect(result.compactSections).toEqual(result.fullSections);
    expect(result.compactCount).toBe(result.fullCount);
    if (result.tracked) expect(result.compactAnchors).toContainEqual(result.tracked);
  };
  await check(true, true);
  await page.evaluate(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>("#publication iframe")) {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const style = doc.createElement("style");
      style.id = "blank-control";
      style.textContent = "p[id], img[id] { visibility: hidden !important; }";
      doc.head.append(style);
    }
  });
  await check(false, true);
  await page.evaluate(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>("#publication iframe"))
      frame.contentDocument?.getElementById("blank-control")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "hit-control";
    overlay.style.cssText = "position:fixed;inset:0;z-index:999999;background:white";
    document.body.append(overlay);
  });
  await check(true, false);
  await page.locator("#hit-control").evaluate((node) => node.remove());
  const timings = await page.evaluate(() => {
    const measure = (sample: () => unknown) => {
      const start = performance.now();
      for (let index = 0; index < 100; index++) sample();
      return performance.now() - start;
    };
    return {
      fullMs: measure(() => window.readerFixture.snapshot()),
      compactMs: measure(() => window.readerFixture.sampleFrame()),
    };
  });
  await info.attach("sampling-cost", {
    body: JSON.stringify(timings),
    contentType: "application/json",
  });
});
