import { expect, test, type Locator, type Page } from "@playwright/test";

const guide = "/archeion/docs/customization/custom-themes/";

async function contained(locator: Locator, width: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Expected visible geometry");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
}

async function headerTargets(page: Page) {
  const targets = page.locator("header").first().locator("a, button");
  const boxes = [];
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue;
    await contained(target, page.viewportSize()?.width ?? 0);
    const box = await target.boundingBox();
    if (box) boxes.push(box);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (const other of boxes.slice(i + 1)) {
      const box = boxes[i];
      const overlapX =
        Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
      const overlapY =
        Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
      expect(overlapX > 1 && overlapY > 1, "Header targets must not overlap").toBe(false);
    }
  }
}

test("both sides of every inclusive shell boundary fit in both themes", async ({ page }, info) => {
  await page.goto(guide);
  await page.evaluate(() => document.fonts.ready);
  for (const theme of ["dark", "light"]) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.count()) await toggle.click();
    for (const width of [
      1440, 1241, 1240, 1081, 1080, 901, 900, 801, 800, 691, 690, 601, 600, 401, 400, 390, 320,
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await headerTargets(page);
      await contained(page.getByRole("main"), width);
      const outline = page.getByRole("complementary", { name: "On this page" });
      const sidebar = page.getByRole("complementary", { name: "Documentation navigation" });
      await expect(outline).toBeVisible({ visible: width > 1080 });
      await expect(sidebar).toBeVisible({ visible: width > 800 });
      if (width > 800) {
        for (const link of [
          sidebar.locator('a[aria-current="page"]'),
          sidebar.locator("a:not([aria-current])").first(),
        ]) {
          await expect(link).toHaveCSS("font-size", "14px");
          await expect(link).toHaveCSS("line-height", "23.1px");
        }
      }
      const searchWidth =
        width <= 690
          ? 38
          : width <= 800
            ? 240
            : width <= 900
              ? 260
              : width <= 1080
                ? 330
                : width <= 1240
                  ? 360
                  : 440;
      await expect(
        page.getByRole("button", { name: "Search documentation", exact: true }),
      ).toHaveCSS("width", `${searchWidth}px`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if ([1440, 1080, 800, 390, 320].includes(width))
        await page.screenshot({
          path: info.outputPath(`checkpoint-${width}-${theme}.png`),
          fullPage: true,
        });
    }
  }
});

test("doubled text keeps header actions and short-viewport modal content reachable", async ({
  page,
}, info) => {
  await page.goto(guide);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  for (const width of [1440, 801, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 480 });
    await headerTargets(page);
    await page.getByRole("button", { name: "Search documentation", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    const close = dialog.getByRole("button", { name: "Close search" });
    await close.focus();
    await expect(close).toBeInViewport();
    await contained(close, width);
    const last = dialog.getByRole("link").last();
    await last.focus();
    await expect(last).toBeInViewport();
    await contained(last, width);
    if (width === 320) await page.screenshot({ path: info.outputPath("text-200-search.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    if (width <= 800) {
      await page.getByRole("button", { name: "Open documentation navigation" }).click();
      const drawer = page.getByRole("dialog", { name: "Documentation menu" });
      await drawer.getByRole("link").last().focus();
      await expect(drawer.getByRole("link").last()).toBeInViewport();
      await page.keyboard.press("Escape");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test("skip navigation, keyboard disclosure, and long code/table content keep visible focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto(guide);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page
    .locator("pre code")
    .first()
    .evaluate((code) => {
      code.textContent = "unbroken-example-".repeat(80);
    });
  const pre = page.locator("pre").first();
  await pre.focus();
  await expect(pre).toHaveCSS("outline-style", "solid");
  await contained(pre, 320);
  expect(await pre.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await page
    .locator("td")
    .first()
    .evaluate((cell) => {
      cell.textContent = "unbroken-table-value".repeat(30);
    });
  await contained(page.locator("table").first().locator(".."), 320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Open documentation navigation" }).focus();
  await page.keyboard.press("Enter");
  const summary = page
    .getByRole("dialog", { name: "Documentation menu" })
    .locator("summary")
    .first();
  for (const link of [
    page.locator('#docs-mobile-navigation a[aria-current="page"]'),
    page.locator("#docs-mobile-navigation a:not([aria-current])").first(),
  ]) {
    await expect(link).toHaveCSS("font-size", "14px");
    await expect(link).toHaveCSS("line-height", "23.1px");
  }
  await summary.focus();
  await expect(summary).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Space");
  await expect(summary.locator("..")).not.toHaveAttribute("open");
  await page.keyboard.press("Space");
  await expect(summary.locator("..")).toHaveAttribute("open");
});

test("rendered shell text has readable contrast and uses the bundled fonts", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(guide);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  for (const [selector, family] of [
    ["h1", "Literata"],
    ["article p", "Inter Variable"],
  ]) {
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(
      fonts.some((font) => font.familyName === family && font.isCustomFont && font.glyphCount > 0),
    ).toBe(true);
  }
  await session.detach();
  await expect(page.locator("pre").first()).toHaveCSS("line-height", "24.5px");
  for (const theme of ["dark", "light"]) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.count()) await toggle.click();
    const ratios = await page.evaluate(() => {
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!rgb || rgb.length !== 3) throw new Error(`Expected RGB color: ${color}`);
        const linear = rgb.map((channel) => {
          const s = channel / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      return [
        "article p",
        "header kbd",
        '[aria-label="Breadcrumb"] a',
        '[aria-label="Documentation navigation"] a',
        '[aria-label="Table of contents"] a',
        "main footer a",
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        let parent: Element | null = element;
        while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)")
          parent = parent.parentElement;
        if (!parent) throw new Error(`No painted background for ${selector}`);
        const foreground = luminance(getComputedStyle(element).color);
        const background = luminance(getComputedStyle(parent).backgroundColor);
        return {
          selector,
          ratio:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        };
      });
    });
    for (const pair of ratios)
      expect(pair.ratio, `${theme} ${pair.selector}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("coarse-pointer header targets stay separate with doubled text and forced colors", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 480 },
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}${guide}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await headerTargets(page);
    const opener = page.getByRole("button", { name: "Open documentation navigation" });
    await expect(opener).toHaveCSS("min-width", "44px");
    await opener.tap();
    const drawer = page.getByRole("dialog", { name: "Documentation menu" });
    await expect(drawer.locator('a[aria-current="page"]')).toHaveCSS(
      "text-decoration-line",
      "underline",
    );
    await drawer.getByRole("button", { name: "Close navigation" }).tap();
    await expect(drawer).toBeHidden();
  } finally {
    await context.close();
  }
});
