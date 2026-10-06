import { expect, test, type Locator } from "@playwright/test";

async function inspectThumbnail(row: Locator) {
  const thumbnail = row.locator('[data-preview-size="compact"]');
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute("aria-hidden", "true");
  await expect(thumbnail).toHaveText("");
  await expect(thumbnail.locator("button, a, input, [tabindex], [role], img, canvas")).toHaveCount(
    0,
  );
  const metrics = await thumbnail.evaluate((element) => {
    const navigation = element.querySelector(".theme-shell-preview__navigation")!;
    const workspace = element.querySelector(".theme-shell-preview__workspace")!;
    const content = element.querySelector(".theme-shell-preview__content")!;
    const probe = document.createElement("span");
    element.append(probe);
    const resolved = (variable: string) => {
      probe.style.backgroundColor = `var(${variable})`;
      return getComputedStyle(probe).backgroundColor;
    };
    const boundary = getComputedStyle(navigation);
    const rtl = boundary.direction === "rtl";
    const result = {
      rendered: [navigation, workspace, content].map(
        (region) => getComputedStyle(region).backgroundColor,
      ),
      resolved: ["sidebar", "main", "surface-raised"].map((role) =>
        resolved(`--theme-shell-${role}`),
      ),
      border: boundary.borderInlineEndColor,
      borderResolved: resolved("--theme-shell-line-subtle"),
      borderWidth: boundary.borderInlineEndWidth,
      navigationEnd: rtl
        ? navigation.getBoundingClientRect().left
        : navigation.getBoundingClientRect().right,
      workspaceStart: rtl
        ? workspace.getBoundingClientRect().right
        : workspace.getBoundingClientRect().left,
      height: element.getBoundingClientRect().height,
      thumbnailTop: element.getBoundingClientRect().top,
      thumbnailBottom: element.getBoundingClientRect().bottom,
      nameBottom: element
        .parentElement!.querySelector(".theme-catalog-list__item-name")!
        .getBoundingClientRect().bottom,
      rowBottom: element.parentElement!.getBoundingClientRect().bottom,
    };
    probe.remove();
    return result;
  });
  expect(metrics.thumbnailTop).toBeGreaterThanOrEqual(metrics.nameBottom);
  expect(metrics.thumbnailBottom).toBeLessThanOrEqual(metrics.rowBottom);
  return metrics;
}

test("catalog thumbnails render candidate colors and select through the single named row", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 660 });
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  const navigation = page.getByRole("navigation", { name: "Themes" });
  const hostStyle = await page.locator("html").getAttribute("style");
  for (const name of [
    "Archeion Dark",
    "Archeion Light",
    "Equal shell planes",
    "Distinct shell planes",
  ]) {
    const row = navigation.getByRole("button", { name: new RegExp(`^${name}`) });
    const metrics = await inspectThumbnail(row);
    expect(metrics.rendered).toEqual(metrics.resolved);
    expect(metrics.border).toBe(metrics.borderResolved);
    expect(metrics.borderWidth).toBe("1px");
    expect(metrics.navigationEnd).toBe(metrics.workspaceStart);
    expect(metrics.height).toBeLessThanOrEqual(56);
    if (name === "Equal shell planes") expect(metrics.rendered[0]).toBe(metrics.rendered[1]);
    if (name === "Distinct shell planes") expect(metrics.rendered[0]).not.toBe(metrics.rendered[1]);
    await row.locator('[data-preview-size="compact"]').click();
    await expect(row).toHaveAttribute("aria-current", "true");
    const detailed = page.getByRole("img", { name: "Application shell preview" });
    expect(await row.locator('[data-preview-size="compact"]').getAttribute("style")).toBe(
      await detailed.getAttribute("style"),
    );
    expect(await page.locator("html").getAttribute("style")).toBe(hostStyle);
  }
  for (const name of ["invalid-shell", "unavailable-shell"]) {
    const row = navigation.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(row).toContainText("Needs attention");
    await expect(row.locator('[data-preview-size="compact"]')).toHaveCount(0);
  }
  await expect(navigation.getByRole("img")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("catalog-candidates.png") });
});

test("keyboard selection, focus, density, narrow and doubled text, and forced colors remain usable", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  const navigation = page.getByRole("navigation", { name: "Themes" });
  const dark = navigation.getByRole("button", { name: /^Archeion Dark/ });
  await dark.focus();
  await page.keyboard.press("Tab");
  const light = navigation.getByRole("button", { name: /^Archeion Light/ });
  await expect(light).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(light).toHaveAttribute("aria-current", "true");
  expect(await light.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  expect(await light.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    "none",
  );
  await page.getByRole("button", { name: "Use theme", exact: true }).click();
  await expect(light).toHaveAccessibleName("Archeion Light Selected");
  await page.setViewportSize({ width: 900, height: 660 });
  expect(
    await navigation.locator(".theme-catalog-list__items").evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      return [...list.querySelectorAll("button")].filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }).length;
    }),
  ).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath("catalog-keyboard-light.png") });
  for (const width of [320, 480, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await inspectThumbnail(dark);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({ path: testInfo.outputPath(`catalog-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({
    content: ".theme-catalog-list { --type-body: 28px; --type-caption: 24px; }",
  });
  await dark.focus();
  await inspectThumbnail(dark);
  expect(await navigation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("catalog-doubled-text.png") });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  await inspectThumbnail(dark);
  await page.screenshot({ path: testInfo.outputPath("catalog-rtl.png") });
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await inspectThumbnail(dark);
  expect(forced.borderWidth).toBe("1px");
  await page.screenshot({ path: testInfo.outputPath("catalog-forced-colors.png") });
});

test("a 200-theme catalog scrolls and keyboard-selects the last card without extra targets", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 660 });
  await page.goto("/tests/browser/fixtures/?view=theme-manager&catalog=large");
  const navigation = page.getByRole("navigation", { name: "Themes" });
  await expect(navigation.locator('[data-preview-size="compact"]')).toHaveCount(205);
  const last = navigation.getByRole("button", { name: "Gallery theme 199", exact: true });
  await last.focus();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Space");
  await expect(last).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { name: "Gallery theme 199" })).toBeVisible();
  expect(
    await navigation.locator(".theme-catalog-list__items").evaluate((list) => list.scrollTop),
  ).toBeGreaterThan(0);
  await expect(navigation.locator("button button, button [tabindex], canvas, img")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("catalog-large.png") });
});
