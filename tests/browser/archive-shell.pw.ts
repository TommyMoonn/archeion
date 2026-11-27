import { expect, test, type Page } from "@playwright/test";

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>("[data-archive-catalog]")!;
    const main = document.querySelector<HTMLElement>("[data-archive-detail]")!;
    const titlebar = document.querySelector<HTMLElement>(".window-titlebar")!;
    const sidebarStyle = getComputedStyle(sidebar);
    const mainStyle = getComputedStyle(main);
    const sidebarRect = sidebar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    return {
      sidebarRight: sidebarRect.right,
      mainLeft: mainRect.left,
      mainTop: mainRect.top,
      titlebarBottom: titlebarRect.bottom,
      mainBorders: [
        mainStyle.borderTopWidth,
        mainStyle.borderRightWidth,
        mainStyle.borderBottomWidth,
        mainStyle.borderLeftWidth,
      ],
      mainRadius: mainStyle.borderRadius,
      rightBorder: sidebarStyle.borderInlineEndWidth,
      bottomBorder: sidebarStyle.borderBlockEndWidth,
      rightBorderColor: sidebarStyle.borderInlineEndColor,
      bottomBorderColor: sidebarStyle.borderBlockEndColor,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

function systemColor(page: Page, keyword: "CanvasText" | "Highlight" | "Mark") {
  return page.evaluate((keyword) => {
    const probe = document.createElement("span");
    probe.style.color = keyword;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, keyword);
}

test("Archive Manager retains native control calls and real drag hit areas", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell");
  await expect(page.getByRole("button", { name: "Minimize window", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Maximize or restore window" })).toHaveCount(0);
  for (const x of [100, 285, 400, 700]) {
    expect(
      await page.evaluate(
        (x) => document.elementFromPoint(x, 16)?.hasAttribute("data-tauri-drag-region"),
        x,
      ),
    ).toBe(true);
  }
  for (const [name, command] of [
    ["Minimize window", "plugin:window|minimize"],
    ["Close window", "plugin:window|close"],
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    expect(
      await button.evaluate((element) => element.closest("[data-tauri-drag-region]")),
    ).toBeNull();
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-last-window-command", command);
  }
});

test("Archive Manager keeps focused create form state across the stacking breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell");
  await page.getByRole("button", { name: "Create empty archive" }).click();
  const name = page.getByRole("textbox", { name: /^Archive name/ });
  await name.fill("Retained draft");
  for (const width of [760, 320, 761, 860]) {
    await page.setViewportSize({ width, height: 620 });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Retained draft");
    expect((await shellGeometry(page)).horizontalOverflow).toBe(false);
  }
});

test("Archive Manager forced colors preserve structural boundaries and keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  for (const width of [860, 480]) {
    await page.setViewportSize({ width, height: 620 });
    await page.goto("/tests/browser/fixtures/?view=archive-shell");
    const selected = page.getByRole("button", { name: "Fixture archive fixture-only" });
    await expect(selected).toHaveAttribute("aria-current", "true");
    const geometry = await shellGeometry(page);
    const canvasText = await systemColor(page, "CanvasText");
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.mainRadius).toBe("0px");
    if (width > 760) {
      expect(geometry.rightBorder).toBe("1px");
      expect(geometry.rightBorderColor).toBe(canvasText);
    } else {
      expect(geometry.bottomBorder).toBe("1px");
      expect(geometry.bottomBorderColor).toBe(canvasText);
    }
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const minimize = page.getByRole("button", { name: "Minimize window", exact: true });
    await expect(minimize).toBeFocused();
    expect(await minimize.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "solid",
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(selected).toBeFocused();
    await expect(selected).toHaveCSS("outline-style", "solid");
  }
});

for (const state of ["loading", "fallback", "load-error"]) {
  test(`Archive Manager ${state} retains the content boundary and clears stacked empty navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 860, height: 620 });
    await page.goto(`/tests/browser/fixtures/?view=archive-shell&state=${state}`);
    const status = page.getByRole(state === "loading" ? "status" : "alert");
    await expect(status).toBeVisible();
    const geometry = await shellGeometry(page);
    expect(geometry.mainLeft).toBe(geometry.sidebarRight);
    expect(geometry.mainTop).toBe(geometry.titlebarBottom);
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    await page.setViewportSize({ width: 480, height: 620 });
    await expect(page.locator("[data-archive-catalog]")).toBeHidden();
    const narrow = await shellGeometry(page);
    expect(narrow.mainLeft).toBe(0);
    expect(narrow.mainTop).toBe(narrow.titlebarBottom);
    expect(narrow.horizontalOverflow).toBe(false);
    await expect(status).toBeVisible();
  });
}

test("Archive Manager keeps a long catalog scrollable beside the detail pane", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 420 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell&state=catalog");
  const catalog = page.getByRole("complementary", { name: "Archives" });
  const name = page.getByRole("heading", { name: "Archeion", exact: true });
  await expect(name).toBeInViewport();
  await expect(catalog).toHaveCSS("width", "286px");
  const last = catalog.getByRole("button", { name: /^Saved archive 19 C:\/fixture\// });
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(name).toBeInViewport();
  expect((await shellGeometry(page)).horizontalOverflow).toBe(false);
});

test("Archive Manager announces a missing folder on the current archive", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell&state=missing");
  const selected = page.getByRole("button", { name: "Fixture archive fixture-only" });
  await expect(selected).toHaveAttribute("aria-current", "true");
  await expect(selected).toHaveAccessibleDescription("Archive folder not found");
  await expect(page.getByText("Archive folder not found", { exact: true })).toBeInViewport();
  const geometry = await shellGeometry(page);
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.bottomBorder).toBe("1px");

  await page.emulateMedia({ forcedColors: "active" });
  const row = page.locator("[data-archive-row]").filter({ has: selected });
  await expect(row).toHaveCSS("border-inline-start-style", "double");
  await expect(row).toHaveCSS("border-inline-start-width", "3px");
  await expect(row).toHaveCSS("border-inline-start-color", await systemColor(page, "Highlight"));
});

test("Archive Manager retains the compact inline rename controls", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=archive-shell");
  const trigger = page.getByRole("button", { name: "Actions for Fixture archive", exact: true });
  const menu = page.getByRole("menu", { name: "Actions for Fixture archive" });
  await expect(trigger).toHaveCSS("width", "32px");
  await expect(trigger).toHaveCSS("height", "32px");
  await page
    .getByRole("button", { name: "Fixture archive fixture-only" })
    .click({ button: "right" });
  await expect(menu).toHaveCSS("min-width", "170px");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await trigger.hover();
  const hoverColor = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.mouse.down();
  await expect(trigger).toHaveCSS("background-color", hoverColor);
  await page.mouse.up();
  await expect(menu).toHaveCSS("min-width", "170px");
  await menu.getByRole("menuitem", { name: "Rename archive" }).click();
  const input = page.getByRole("textbox", { name: "Archive display name" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Fixture archive");
  await expect(input).toHaveCSS("padding-inline-end", "58px");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toHaveCSS("min-height", "30px");
  await expect(save).toHaveCSS("padding-inline", "10px");
});

test("Archive Manager keeps its registry error and recovery actions readable in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.setViewportSize({ width: 480, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell&state=registry-error");
  const message = page.getByRole("alert");
  await expect(message).toHaveText(
    "Archives could not be loaded. Close and reopen Archive Manager to try again.",
  );
  const mark = await systemColor(page, "Mark");
  await expect(message).toHaveCSS("background-color", mark);
  await expect(page.getByText("No saved archives", { exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Open folder as archive" })).toBeVisible();
});
