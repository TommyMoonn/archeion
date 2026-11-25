import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=0&motion=off&folders";

for (const { size, height } of [
  { size: "small", height: 100 },
  { size: "medium", height: 116 },
  { size: "large", height: 136 },
]) {
  test(`Folder ${size} cards retain fixed geometry and visible actions`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${fixture}&folderView=cards&folderCardSize=${size}`);
    await page
      .getByRole("navigation", { name: "Library navigation" })
      .getByRole("button", { name: "Folders", exact: true })
      .click();
    const surface = page.getByRole("region", { name: "Folders", exact: true });
    const entry = surface.locator('[data-library-folder-path="Fiction"]');
    const open = entry.locator("[data-library-folder-primary-action]");
    const menu = entry.getByRole("button", { name: "Actions for Fiction" });
    await expect(open).toBeVisible();
    await expect(open).toHaveCSS("min-height", `${height}px`);
    await expect(open).toHaveCSS("border-radius", "12px");
    await expect(menu).toHaveCSS("opacity", "1");
    await expect(menu).toHaveCSS("width", "32px");
    await expect(entry.locator(".folder-browser__count")).toHaveCSS(
      "font-variant-numeric",
      "tabular-nums",
    );
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Move folder" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await surface.getByRole("radio", { name: "List", exact: true }).click();
    await expect(open).toHaveCSS("min-height", "58px");
    await expect(open).toHaveCSS("border-top-width", "0px");
    await expect(entry).toHaveCSS("border-bottom-width", "1px");
  });
}

test("Folder results keep toolbar width and fixed spacing with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await page.goto(`${fixture}&folderView=cards`);
  await page
    .getByRole("navigation", { name: "Library navigation" })
    .getByRole("button", { name: "Folders", exact: true })
    .click();
  const surface = page.getByRole("region", { name: "Folders", exact: true });
  await expect(surface.locator("[data-library-folder-primary-action]").first()).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  const header = surface.locator("header");
  const results = surface.locator(".collection-content__items");
  const sort = surface.getByRole("combobox", { name: "Sort folders" });
  const view = surface.getByRole("radiogroup", { name: "Folder view" });
  await expect(results).toHaveCSS("gap", "12px");
  const firstWidthDifference = await results.evaluate((node) => {
    const first = node.querySelector("article");
    if (!first) throw new Error("Missing folder card");
    return Math.abs(node.getBoundingClientRect().width - first.getBoundingClientRect().width);
  });
  expect(firstWidthDifference).toBeLessThanOrEqual(1);
  const bounds = await Promise.all([
    header.boundingBox(),
    results.boundingBox(),
    sort.boundingBox(),
    view.boundingBox(),
  ]);
  const [headerBox, resultsBox, sortBox, viewBox] = bounds;
  if (!headerBox || !resultsBox || !sortBox || !viewBox) throw new Error("Missing folder geometry");
  expect(Math.abs(headerBox.x - resultsBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(headerBox.width - resultsBox.width)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(sortBox.y + sortBox.height / 2 - viewBox.y - viewBox.height / 2),
  ).toBeLessThanOrEqual(1);
  expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
  await surface.getByRole("searchbox", { name: "Search folders" }).fill("Mystery");
  await expect(surface.locator('[data-library-folder-path="Fiction/Mystery"]')).toBeVisible();
  await expect(surface.locator('[data-library-folder-path="Nonfiction"]')).toHaveCount(0);
  await surface.getByRole("button", { name: "Clear folder search" }).click();
  await expect(surface.locator('[data-library-folder-path="Nonfiction"]')).toBeVisible();
});

test("Folder tree preserves indentation, keyboard navigation, scrolling and action visibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(fixture);
  const tree = page.getByRole("list", { name: "Library folders" });
  const parent = tree.getByRole("button", { name: "Fiction", exact: true });
  const child = tree.getByRole("button", { name: "Mystery", exact: true });
  const grandchild = tree.getByRole("button", { name: "Classic", exact: true });
  const menu = tree.getByRole("button", { name: "Actions for Fiction", exact: true });
  await expect(parent).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(menu).toHaveCSS("opacity", "0");
  await parent.hover();
  await expect(menu).toHaveCSS("opacity", "1");
  const [parentBox, childBox, grandchildBox] = await Promise.all([
    parent.boundingBox(),
    child.boundingBox(),
    grandchild.boundingBox(),
  ]);
  if (!parentBox || !childBox || !grandchildBox) throw new Error("Missing folder tree geometry");
  expect(childBox.x - parentBox.x).toBeCloseTo(11, 0);
  expect(grandchildBox.x - childBox.x).toBeCloseTo(11, 0);
  expect(parentBox.height).toBe(36);
  await page.mouse.move(0, 0);
  await parent.focus();
  await expect(menu).toHaveCSS("opacity", "1");
  await parent.press("ArrowRight");
  await expect(child).toBeFocused();
  await child.press("ArrowRight");
  await expect(grandchild).toBeFocused();
  await grandchild.press("ArrowLeft");
  await expect(child).toBeFocused();
  await child.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Rename folder" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(child).toBeFocused();
  await child.press("End");
  await expect(tree.getByRole("button", { name: "Shelf 16", exact: true })).toBeFocused();
  await expect(tree.getByRole("button", { name: "Shelf 16", exact: true })).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(parent).toBeFocused();
  await parent.press("Enter");
  await expect(parent).toHaveAttribute("aria-current", "page");
});

test("Deep folder rows keep the name and actions reachable without widening the sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`${fixture}&deepFolders`);
  const tree = page.getByRole("list", { name: "Library folders" });
  const root = tree.getByRole("button", { name: "Fiction", exact: true });
  const deep = tree.getByRole("button", { name: "Level 12", exact: true });
  const menu = tree.getByRole("button", { name: "Actions for Level 12", exact: true });
  await expect(root).toBeVisible();
  const treeWidth = await tree.evaluate((node) => node.getBoundingClientRect().width);
  const rootWidth = await root.evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(rootWidth - treeWidth)).toBeLessThanOrEqual(1);
  await deep.focus();
  await expect(deep).toBeFocused();
  await expect(deep).toHaveCSS("height", "36px");
  await menu.scrollIntoViewIfNeeded();
  await expect(menu).toBeInViewport();
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "Rename folder" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveCSS("width", "32px");
});

test.describe("Touch folder actions", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 700 } });
  test("Folder tree actions remain visible for touch input", async ({ page }) => {
    await page.goto(fixture);
    const tree = page.getByRole("list", { name: "Library folders" });
    await expect(tree.getByRole("button", { name: "Actions for Fiction", exact: true })).toHaveCSS(
      "opacity",
      "1",
    );
  });
});
