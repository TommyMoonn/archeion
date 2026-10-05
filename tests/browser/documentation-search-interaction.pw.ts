import { expect, test, type Page } from "@playwright/test";

async function openSearch(page: Page) {
  await page.goto("/docs/documentation/", { waitUntil: "load" });
  const trigger = page.getByRole("button", { name: "Search documentation", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox", { name: "Search documentation content" });
  await expect(input).toBeFocused();
  return {
    trigger,
    dialog,
    input,
    links: dialog.locator("[data-search-results] a"),
    toggle: dialog.getByRole("button", { name: "Show details", exact: true }),
  };
}

test("input-first dialog preserves result identity, selection, and accessible names across modes", async ({
  page,
}) => {
  const { dialog, input, links, toggle } = await openSearch(page);
  await expect(dialog.getByRole("heading")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /close/i })).toHaveCount(0);
  await input.fill("archive health");
  await expect(links.first().locator("strong mark")).toHaveText(/archive/i);
  const before = await links.evaluateAll((nodes) =>
    nodes.map((node) => ({
      href: node.getAttribute("href"),
      label: node.getAttribute("aria-labelledby"),
      text: node.querySelector("strong")?.textContent,
    })),
  );
  await input.press("ArrowDown");
  await links.first().press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  const active = await links.nth(1).getAttribute("href");
  await page.evaluate(() => {
    (window as unknown as { searchNode: Element | null }).searchNode =
      document.querySelector("[data-search-results] a");
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toBeFocused();
  expect(
    await links.evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute("href"),
        label: node.getAttribute("aria-labelledby"),
        text: node.querySelector("strong")?.textContent,
      })),
    ),
  ).toEqual(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { searchNode: Element }).searchNode ===
        document.querySelector("[data-search-results] a"),
    ),
  ).toBe(true);
  await expect(dialog.locator('[data-active="true"]')).toHaveAttribute("href", active!);
  await expect(links.first().locator("[data-search-excerpt]")).toBeVisible();
  await expect(links.first()).toHaveAccessibleName("Archive health Using Archeion");
  await expect(links.first()).toHaveAccessibleDescription(/duplicates/i);
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(links.first()).toHaveAccessibleName("Archive health Using Archeion");
  await expect(links.first()).toHaveAccessibleDescription("");
});

test("arrows and Enter activate results while Tab reaches the toggle and native links", async ({
  page,
}) => {
  const { input, links, toggle } = await openSearch(page);
  await input.fill("matching digest");
  await input.press("Tab");
  await expect(toggle).toBeFocused();
  await toggle.press("Tab");
  await expect(links.first()).toBeFocused();
  await links.first().press("ArrowUp");
  await expect(input).toBeFocused();
  await input.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  await links.first().press("Enter");
  await expect(page).toHaveURL(/archive-health\/#duplicates$/);
});

test("input Enter activates the first match and same-page navigation focuses its heading", async ({
  page,
}) => {
  const { input } = await openSearch(page);
  await input.fill("matching digest");
  await input.press("Enter");
  await expect(page).toHaveURL(/archive-health\/#duplicates$/);
  // The URL commits before the destination's deferred shortcut handler is ready.
  await page.waitForLoadState("load");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  await dialog.getByRole("searchbox").fill("matching digest");
  await dialog.getByRole("searchbox").press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#duplicates")).toBeFocused();
});

test("Escape and backdrop restore focus, including shortcut open and rapid reopen", async ({
  page,
}) => {
  const { trigger, dialog, input } = await openSearch(page);
  await input.fill("archive");
  await input.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const home = page.getByRole("banner").getByRole("link", { name: "Home", exact: true });
  await home.focus();
  await page.keyboard.press("Meta+k");
  await expect(input).toBeFocused();
  await page.keyboard.press("Control+k");
  await input.press("Escape");
  await expect(home).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("[data-search-dialog]")!;
    dialog.close();
    document.querySelector<HTMLButtonElement>("[data-search-trigger]")!.click();
  });
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
});

test("padding clicks and a drag out of the dialog do not dismiss it", async ({ page }) => {
  const { dialog, input } = await openSearch(page);
  const bounds = (await dialog.boundingBox())!;
  await page.mouse.click(bounds.x + 4, bounds.y + 4);
  await expect(dialog).toBeVisible();
  const field = (await input.boundingBox())!;
  await page.mouse.move(field.x + 20, field.y + 15);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
});

test("modified result activation keeps the original dialog open", async ({ page, context }) => {
  const { input, links, dialog } = await openSearch(page);
  await input.fill("matching digest");
  const newPage = context.waitForEvent("page");
  await links.first().click({ modifiers: ["Control"] });
  const opened = await newPage;
  await opened.waitForLoadState("domcontentloaded");
  await expect(opened).toHaveURL(/archive-health\/#duplicates$/);
  await expect(dialog).toBeVisible();
  await opened.close();
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`${theme} search at ${width}px survives detailed results and doubled text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { dialog, input, toggle, links } = await openSearch(page);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await input.fill("archive");
      await dialog.screenshot({
        path: test.info().outputPath(`search-${theme}-${width}-compact.png`),
      });
      await toggle.click();
      await expect(links.first().locator("[data-search-excerpt]")).toBeVisible();
      await dialog.screenshot({
        path: test.info().outputPath(`search-${theme}-${width}-detailed.png`),
      });
      await dialog.evaluate((element) => {
        const nodes = [
          ...element.querySelectorAll<HTMLElement>("input, button, strong, span, p, kbd, mark"),
        ];
        const sizes = nodes.map((node) => parseFloat(getComputedStyle(node).fontSize));
        nodes.forEach((node, i) => {
          node.style.fontSize = `${sizes[i] * 2}px`;
        });
      });
      await expect(input).toHaveCSS("font-size", "32px");
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(toggle).toBeInViewport();
      await input.focus();
      await input.press("ArrowDown");
      await expect(links.first()).toBeFocused();
      await expect(links.first()).toBeInViewport();
      await dialog.screenshot({
        path: test.info().outputPath(`search-${theme}-${width}-double-text.png`),
      });
      await input.fill("no-such-result");
      await expect(dialog.getByRole("status")).toHaveText("No matching results.");
      await expect(dialog.locator("[data-search-empty]")).toBeVisible();
    });
  }
}

test("reduced motion and forced colors retain visible keyboard state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const { dialog, input, links, toggle } = await openSearch(page);
  await expect(dialog).toHaveCSS("animation-name", "none");
  await input.fill("archive");
  await input.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  expect(
    await links.first().evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
  ).toBeGreaterThanOrEqual(2);
  expect(
    await links
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration)),
  ).toBeLessThanOrEqual(0.00001);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await dialog.screenshot({ path: test.info().outputPath("search-forced-colors.png") });
});
