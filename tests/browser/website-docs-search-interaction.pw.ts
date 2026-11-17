import { expect, test, type Page } from "@playwright/test";

async function openSearch(page: Page) {
  await page.goto("/archeion/docs/", { waitUntil: "load" });
  const trigger = page.getByRole("button", { name: "Search documentation", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  const input = dialog.getByRole("searchbox", { name: "Search documentation" });
  await expect(input).toBeFocused();
  return {
    trigger,
    dialog,
    input,
    links: dialog.getByRole("navigation", { name: "Documentation search results" }).locator("a"),
  };
}

test("search results stay compact with full accessible titles and keyboard selection", async ({
  page,
}) => {
  const { dialog, input, links } = await openSearch(page);
  await expect(dialog.getByRole("button", { name: "Show details" })).toHaveCount(0);
  await expect(input).toHaveCSS("outline-style", "none");
  await expect(dialog).toHaveCSS("backdrop-filter", "none");
  const backdrop = await dialog.evaluate((node) => {
    const style = getComputedStyle(node, "::backdrop");
    return { blur: style.backdropFilter, background: style.backgroundColor };
  });
  expect(backdrop).toEqual({ blur: "none", background: "rgba(0, 0, 0, 0.45)" });
  await input.fill("archive health");
  await expect(links.first()).toHaveAccessibleName("Archive health Using Archeion");
  expect(await links.first().locator(":scope > span").count()).toBe(2);
  await expect(links.first()).toHaveAttribute("title", "Archive health \u2014 Using Archeion");
  await expect(links.first().locator("mark").first()).toHaveText(/archive/i);
  await input.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  await expect(links.first()).toHaveCSS("outline-style", "solid");
  await links.first().press("ArrowUp");
  await expect(input).toBeFocused();
  await expect(input).toHaveCSS("outline-style", "solid");
  await input.click();
  await expect(input).toHaveCSS("outline-style", "none");
  await input.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(input).toHaveCSS("outline-style", "solid");
  await input.press("Escape");
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  await input.fill("asd");
  await expect(input).toHaveCSS("outline-style", "none");
});

for (const { platform, hint } of [
  { platform: "MacIntel", hint: "⌘ K" },
  { platform: "Win32", hint: "Ctrl K" },
]) {
  test(`${platform} displays its shortcut and accepts both keyboard modifiers`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, "platform", { configurable: true, value });
    }, platform);
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|did not match/i.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    await page.goto("/archeion/docs/", { waitUntil: "load" });
    const trigger = page.getByRole("button", { name: "Search documentation", exact: true });
    const shortcut = trigger.locator("kbd");
    await expect(shortcut).toHaveText(hint);
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    const input = dialog.getByRole("searchbox", { name: "Search documentation" });
    const home = page.getByRole("banner").getByRole("link", { name: "Home", exact: true });
    for (const keys of ["Control+k", "Meta+k"]) {
      await home.focus();
      await page.keyboard.press(keys);
      await expect(dialog).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS("outline-style", "solid");
      await input.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(home).toBeFocused();
    }
    expect(hydrationErrors).toEqual([]);
  });
}

test("arrows and Enter activate results while Tab reaches native links", async ({ page }) => {
  const { dialog, input, links } = await openSearch(page);
  await input.fill("matching digest");
  await input.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close search" })).toBeFocused();
  await page.keyboard.press("Tab");
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
  // The URL commits before the destination and its navigation focus effect settle.
  await expect(page.locator("#duplicates")).toBeFocused();
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
  await input.press("Escape");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
});

test("padding clicks and a drag out of the dialog do not dismiss it", async ({ page }) => {
  const { dialog, input } = await openSearch(page);
  const bounds = (await dialog.locator("section").boundingBox())!;
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
    test(`${theme} search at ${width}px survives compact results and doubled text`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { dialog, input, links } = await openSearch(page);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await input.fill("archive");
      await expect(links.first()).toHaveCSS("font-family", /Inter Variable/);
      await expect(links.first().locator(":scope > span").first()).toHaveCSS("font-size", "14px");
      await expect(links.first().locator(":scope > span").nth(1)).toHaveCSS("font-size", "13px");
      await expect(links.first().locator(":scope > span").nth(1)).toHaveCSS(
        "letter-spacing",
        "normal",
      );
      await dialog.screenshot({
        path: test.info().outputPath(`search-${theme}-${width}-compact.png`),
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
      await expect(dialog.getByRole("button", { name: "Close search" })).toBeInViewport();
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
  const { dialog, input, links } = await openSearch(page);
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
  await dialog.screenshot({ path: test.info().outputPath("search-forced-colors.png") });
});
