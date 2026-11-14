import { expect, test } from "@playwright/test";

test("fixture shell uses the approved desktop rails and local typography", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/archeion/docs/fixtures/sample-guide");
  await page.evaluate(() => document.fonts.ready);
  const header = page.locator("header").first();
  const sidebar = page.getByRole("complementary", { name: "Documentation navigation" });
  const main = page.getByRole("main");
  const outline = page.getByRole("complementary", { name: "On this page" });
  await expect(header).toHaveCSS("height", "68px");
  await expect(sidebar).toHaveCSS("width", "230px");
  await expect(outline).toHaveCSS("width", "170px");
  await expect(main).toHaveCSS("max-width", "700px");
  const search = page.getByRole("button", { name: "Search documentation", exact: true });
  await expect(search).toHaveCSS("width", "440px");
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox && searchBox.x + searchBox.width / 2).toBeCloseTo(720, 0);
  const boxes = await Promise.all([
    sidebar.boundingBox(),
    main.boundingBox(),
    outline.boundingBox(),
  ]);
  const [left, article, right] = boxes;
  expect(left && article && article.x - left.x - left.width).toBeGreaterThanOrEqual(28);
  expect(right && article && right.x - article.x - article.width).toBeGreaterThanOrEqual(28);
  await expect(main.locator("..")).toHaveCSS("column-gap", "28px");
  await expect(sidebar.locator("..")).toHaveCSS("column-gap", "28px");
  await expect(main.locator("h1")).toHaveCount(1);
  await expect(main.locator("h1")).toHaveCSS("font-family", /Literata/);
  await expect(main.locator("h2").first()).toHaveCSS("font-size", "31px");
  await expect(main.locator("article > div p").first()).toHaveCSS("line-height", "29.6px");
  await expect(main.getByRole("link", { name: "Edit this page" })).toHaveAttribute(
    "href",
    /website\/docs\/shell-guide.mdx$/,
  );
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
    "Getting started",
  );
  await expect(sidebar.getByRole("link", { name: "A sample guide", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Table of contents" })
      .getByRole("link", { name: "Check the details" }),
  ).toHaveAttribute("href", "#check-the-details");
  await expect(sidebar.getByRole("link", { name: "Website foundation", exact: true })).toHaveCSS(
    "color",
    "rgb(189, 195, 200)",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await expect(sidebar).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(10, 10, 11)" : "rgb(247, 248, 247)",
    );
    await expect(search).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(26, 26, 27)" : "rgb(255, 255, 255)",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`shell-${theme}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("native routes, framework neighbors, and static article output stay coherent", async ({
  page,
  browser,
}) => {
  await page.goto("/archeion/docs/");
  const pager = page.getByRole("navigation", { name: "Documentation pages" });
  await expect(pager.getByRole("link")).toHaveCount(1);
  await pager.getByRole("link", { name: "Next Website foundation" }).click();
  await expect(page).toHaveURL(/\/docs\/foundation$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Website foundation");
  await page
    .getByRole("navigation", { name: "Documentation pages" })
    .getByRole("link", { name: "Next A sample guide" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A sample guide");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A sample guide");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Website foundation");
  await page.goto("/archeion/docs/fixtures/sample-reference");
  await expect(pager.getByRole("link")).toHaveCount(1);
  await expect(pager.getByRole("link")).toHaveText("PreviousA sample guide");
  // Development serves a client-rendered entry; production owns static readability.
  if (process.env.ARCHEION_WEBSITE_MODE === "dev") return;
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await noScript.newPage();
    await staticPage.goto(new URL("/archeion/docs/fixtures/sample-guide", page.url()).href);
    await expect(staticPage.getByRole("heading", { level: 1 })).toHaveText("A sample guide");
    await expect(
      staticPage.getByRole("navigation", { name: "Documentation pages" }).getByRole("link"),
    ).toHaveCount(2);
    await expect(staticPage.getByRole("heading", { name: "Check the details" })).toHaveAttribute(
      "id",
      "check-the-details",
    );
  } finally {
    await noScript.close();
  }
});

test("search surface is a keyboard-dismissible fixture with framework links", async ({
  page,
}, testInfo) => {
  await page.goto("/archeion/docs/");
  const trigger = page.getByRole("button", { name: "Search documentation", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Search documentation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Search documentation" })).toBeFocused();
  await expect(dialog.getByRole("link")).toHaveCount(4);
  await expect(dialog.locator("section")).toHaveCSS("max-width", "680px");
  await page.screenshot({ path: testInfo.outputPath("search-surface.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("link", { name: "A sample guide Temporary document" }).click();
  await expect(page).toHaveURL(/\/docs\/fixtures\/sample-guide$/);
  await expect(dialog).toBeHidden();
});

test("shell presentation switches at the mapped inclusive width boundaries", async ({
  page,
}, testInfo) => {
  await page.goto("/archeion/docs/fixtures/sample-guide");
  const search = page.getByRole("button", { name: "Search documentation", exact: true });
  for (const [width, searchWidth] of [
    [1240, 360],
    [1080, 330],
    [900, 260],
    [800, 240],
    [690, 38],
    [600, 38],
    [400, 38],
    [320, 38],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(search).toHaveCSS("width", `${searchWidth}px`);
    if (width <= 1080)
      await expect(page.getByRole("complementary", { name: "On this page" })).toBeHidden();
    if (width <= 800)
      await expect(
        page.getByRole("complementary", { name: "Documentation navigation" }),
      ).toBeHidden();
    await expect(page.locator("header").first()).toHaveCSS(
      "height",
      width <= 600 ? "62px" : "68px",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await search.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
    if (width === 800 || width === 320)
      await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`), fullPage: true });
  }
});
