import { writeFile } from "node:fs/promises";
import { startUIStabilityCapture } from "./ui-stability-capture";
import { expect, test } from "@playwright/test";

for (const cache of ["cold", "warm"]) {
  test(`UX-15 Add EPUB first paint ${cache}`, async ({ page }, info) => {
    if (cache === "warm") {
      await page.goto("/tests/browser/fixtures/ui-stability.html?count=0&motion=off");
      await expect(page.locator(".empty-state")).toBeVisible();
      await page.getByRole("button", { name: "Add EPUB", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Add EPUB files" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await page.addInitScript(() => {
      const samples: unknown[] = [];
      let raf = 0;
      const tick = () => {
        const dialog = document.querySelector("dialog[open]");
        if (dialog && samples.length < 300) {
          const bounds = (node: Element) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            const box = node.getBoundingClientRect();
            return {
              tag: node.tagName,
              className: node.getAttribute("class"),
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              textWidth: rect.width,
              textHeight: rect.height,
            };
          };
          samples.push({
            time: performance.now(),
            fonts: document.fonts.status,
            bounds: [...dialog.querySelectorAll("h2, .button__label, svg")].map(bounds),
          });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      Object.assign(window, {
        visualFontTrace: () => {
          cancelAnimationFrame(raf);
          return samples;
        },
      });
    });
    const finish = await startUIStabilityCapture(page, info);
    await page.goto("/tests/browser/fixtures/ui-stability.html?count=0&motion=off");
    await expect(page.locator(".empty-state")).toBeVisible();
    await page.evaluate(() => window.uiStabilityProbe.mark("before-add-epub"));
    await page.getByRole("button", { name: "Add EPUB", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add EPUB files" })).toBeVisible();
    await page.evaluate(() => window.uiStabilityProbe.mark("add-epub-visible"));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let count = 0;
          const tick = () => (++count >= 30 ? resolve() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
    );
    await page.screenshot({ path: info.outputPath("add-epub.png") });
    const fontTrace = await page.evaluate(() =>
      (window as unknown as { visualFontTrace: () => unknown[] }).visualFontTrace(),
    );
    const boundsPath = info.outputPath("modal-font-bounds.json");
    await writeFile(boundsPath, JSON.stringify(fontTrace, null, 2));
    await info.attach("modal-font-bounds", { path: boundsPath, contentType: "application/json" });
    const report = await finish({
      cache,
      operation: "first Add EPUB modal",
      motion: "off to isolate font/layout",
      native: false,
    });
    expect(report.probe.frames.at(-1)!.fonts.status).toBe("loaded");
    expect(report.probe.paints.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}
