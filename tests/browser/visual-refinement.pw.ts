import { writeFile } from "node:fs/promises";
import { startUIStabilityCapture } from "./ui-stability-capture";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark", "custom"]) {
  for (const width of [560, 1280]) {
    test(`restrained corners ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/tests/browser/fixtures/visual-refinement.html");
      await page.evaluate((theme) => {
        document.documentElement.dataset.appTheme = theme;
        document.documentElement.dataset.focusPresentation = "keyboard-navigation";
        if (theme === "custom") {
          document.documentElement.style.setProperty("--accent", "#9299c7");
          document.documentElement.style.setProperty("--surface", "#242530");
        }
      }, theme);
      const buttons = page.locator(".button");
      for (const button of await buttons.all()) {
        await expect(button).toHaveCSS("border-radius", "6px");
      }
      const first = buttons.first();
      await first.focus();
      await expect(first).toHaveCSS("outline-width", "2px");
      const heights = await buttons.evaluateAll((nodes) =>
        nodes.slice(0, 12).map((node) => node.getBoundingClientRect().height),
      );
      expect(heights).toEqual([32, 32, 32, 32, 36, 36, 36, 36, 40, 40, 40, 40]);
      await expect(page.locator(".segmented-control")).toHaveCSS("border-radius", "6px");
      await expect(page.locator(".segmented-control__option").first()).toHaveCSS(
        "border-radius",
        "2px",
      );
      await page.screenshot({ path: info.outputPath("controls.png"), fullPage: true });
      await page.getByRole("button", { name: "Open dialog", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCSS("border-radius", "8px");
      await page.screenshot({ path: info.outputPath("dialog.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
    });
  }
}

test("production collection empty and search states retain their meaning", async ({
  page,
}, info) => {
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=0&motion=off");
  await expect(page.getByRole("heading", { name: "No EPUB files found" })).toBeVisible();
  await expect(
    page.locator(".segmented-control--icon-only .segmented-control__option").first(),
  ).toHaveCSS("border-radius", "6px");
  const empty = page.locator(".empty-state");
  await expect(empty.locator(".empty-state__icon svg")).toHaveCSS("width", "32px");
  await expect(empty.locator(".empty-state__glow")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("library-empty.png") });
  const search = page.getByRole("searchbox").first();
  await search.fill("missing book");
  await expect(page.getByRole("heading", { name: "No search results" })).toBeVisible();
  await expect(empty.locator("svg")).toHaveCount(0);
  await empty.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No EPUB files found" })).toBeVisible();
});

for (const theme of ["light", "dark", "custom"]) {
  for (const width of [560, 1280]) {
    test(`contextual destinations ${theme} ${width} larger text`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/tests/browser/fixtures/ui-stability.html?count=0&motion=off&theme=${theme}`,
      );
      await expect(page.locator(".empty-state")).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "24px";
      });
      const emptyStateCenters: number[] = [];
      for (const [destination, title, glyph] of [
        ["Library", "No EPUB files found", "book-open-text"],
        ["Favorites", "No favorites yet", "heart"],
        ["Folders", "No folders yet", "folder"],
        ["Series", "No series metadata", "layers"],
      ]) {
        await page
          .getByRole("navigation", { name: "Library navigation" })
          .getByRole("button", { name: destination, exact: true })
          .click();
        const empty = page.locator(".empty-state");
        await expect(empty.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(empty.locator(`svg.lucide-${glyph}`)).toBeVisible();
        await expect(empty.locator(".empty-state__icon svg")).toHaveCSS("width", "32px");
        expect(await empty.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        emptyStateCenters.push(
          await empty.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return bounds.top + bounds.height / 2;
          }),
        );
        await page.screenshot({ path: info.outputPath(`${destination}.png`) });
      }
      expect(Math.max(...emptyStateCenters) - Math.min(...emptyStateCenters)).toBeLessThanOrEqual(
        1,
      );
      await page
        .getByRole("navigation", { name: "Library navigation" })
        .getByRole("button", { name: "Folders", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: "Folders", exact: true })).toBeVisible();
      await page
        .getByRole("searchbox", { name: "Search folders", exact: true })
        .fill("missing folder");
      await expect(
        page.locator(".empty-state").getByRole("heading", { name: "No folders found" }),
      ).toBeVisible();
      await expect(page.locator(".empty-state svg")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("folder-no-results.png") });
    });
  }
}

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

test("Add EPUB entrance fades without shifting its contents", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=0&motion=on");
  await expect(page.locator(".empty-state")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--motion-duration-emphasized", "1200ms"),
  );

  await page.getByRole("button", { name: "Add EPUB", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add EPUB files" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".add-epub-dialog")).toBeVisible();

  const samples = await dialog.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find(
        (candidate) => (candidate as CSSAnimation).animationName === "dialog-presence-fade-enter",
      );
    if (!animation) throw new Error("Add EPUB fade entrance animation was not found.");
    animation.pause();

    const timing = animation.effect?.getTiming();
    if (!timing) throw new Error("Add EPUB fade entrance has no timing effect.");
    const duration = Number(timing.duration);
    const targets = [
      element,
      element.querySelector(".dialog__panel"),
      element.querySelector("h2"),
      element.querySelector(".dialog__body"),
      element.querySelector(".dialog__bottom"),
    ];
    const capture = (time: number) => {
      animation.currentTime = time;
      const bounds = targets.map((target) => {
        if (!target) throw new Error("Add EPUB dialog layout target was not found.");
        const { x, y, width, height } = target.getBoundingClientRect();
        return { x, y, width, height };
      });
      return { bounds, opacity: Number(getComputedStyle(element).opacity) };
    };

    return {
      name: (animation as CSSAnimation).animationName,
      duration,
      start: capture(0),
      middle: capture(duration / 2),
      end: capture(duration),
    };
  });

  expect(samples.name).toBe("dialog-presence-fade-enter");
  expect(samples.duration).toBe(1200);
  expect(samples.start.bounds).toEqual(samples.middle.bounds);
  expect(samples.middle.bounds).toEqual(samples.end.bounds);
  expect(samples.start.opacity).toBeLessThan(samples.end.opacity);
  expect(samples.end.opacity).toBe(1);
});

test("filter no-results is text-only and clears back to the collection", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=2&motion=off");
  await expect(page.locator(".book-card").first()).toBeVisible();
  await page.locator("summary[aria-label='Filter library']").click();
  await page.getByRole("checkbox", { name: "Completed", exact: true }).check();
  await page.locator("summary[aria-label='Filter library']").click();
  await expect(page.getByRole("heading", { name: "No matching books" })).toBeVisible();
  await expect(page.locator(".empty-state svg")).toHaveCount(0);
  await page.locator(".empty-state").getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".book-card").first()).toBeVisible();
});
