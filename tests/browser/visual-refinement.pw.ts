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

test("Add EPUB expands as one surface and settles before the fade completes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=0&motion=on");
  await expect(page.locator(".empty-state")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "on");
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.documentElement.style.setProperty("--motion-duration-emphasized", "1500ms");
  });

  await page.getByRole("button", { name: "Add EPUB", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add EPUB files" });
  await expect(dialog.getByRole("group", { name: "Operation" })).toBeVisible();

  const samples = await dialog.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Dialog element is missing");
    const animation = element
      .getAnimations()
      .find(
        (candidate) =>
          candidate instanceof CSSAnimation && candidate.animationName === "dialog-presence-enter",
      );
    if (!animation?.effect) throw new Error("Shared dialog entrance is missing");
    const duration = Number(animation.effect.getTiming().duration);
    // Base UI's visually hidden form inputs are fixed-position elements, not
    // part of the rendered surface. Their containing block changes with transform.
    const targets = [
      element,
      ...element.querySelectorAll<HTMLElement>(
        'h2, button, input:not([aria-hidden="true"]):not([type="hidden"]), .app-select__label, [role="group"] > span',
      ),
    ];
    const pose = () => {
      const bounds = element.getBoundingClientRect();
      return {
        positions: targets.map((target) => {
          const { x, y, width, height } = target.getBoundingClientRect();
          return [x, y, width, height];
        }),
        center: [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
        opacity: Number(getComputedStyle(element).opacity),
      };
    };
    const capture = (time: number) => {
      animation.currentTime = time;
      return pose();
    };
    animation.pause();
    const start = capture(0);
    const middle = capture(duration * 0.65);
    const end = capture(duration);
    animation.finish();
    const settled = pose();
    return { start, middle, end, settled };
  });

  for (const [index, position] of samples.start.positions.entries()) {
    expect(position[2] / samples.end.positions[index][2]).toBeCloseTo(0.985, 3);
  }
  expect(samples.middle.positions).toEqual(samples.end.positions);
  expect(samples.settled.positions).toEqual(samples.end.positions);
  for (const pose of [samples.start, samples.middle]) {
    expect(Math.abs(pose.center[0] - samples.end.center[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(pose.center[1] - samples.end.center[1])).toBeLessThanOrEqual(1);
  }
  expect(samples.start.opacity).toBeLessThan(samples.middle.opacity);
  expect(samples.middle.opacity).toBeLessThan(samples.end.opacity);
  expect(samples.end.opacity).toBe(1);
});

test("filter no-results is text-only and clears back to the collection", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=2&motion=off");
  await expect(page.locator(".book-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Filter library" }).click();
  await page.getByRole("checkbox", { name: "Completed", exact: true }).check();
  await page.getByRole("button", { name: "Filter library" }).click();
  await expect(page.getByRole("heading", { name: "No matching books" })).toBeVisible();
  await expect(page.locator(".empty-state svg")).toHaveCount(0);
  await page.locator(".empty-state").getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".book-card").first()).toBeVisible();
});
