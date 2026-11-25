import { expect, test, type Page } from "@playwright/test";

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".archive-manager-window__sidebar")!;
    const main = document.querySelector<HTMLElement>(".archive-manager-window__main")!;
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

test("Archive Manager retains native control calls and real drag hit areas", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 620 });
  await page.goto("/tests/browser/fixtures/?view=archive-shell");
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
  const name = page.locator("#archive-create-name");
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
    const geometry = await shellGeometry(page);
    const systemColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.mainRadius).toBe("0px");
    if (width > 760) {
      expect(geometry.rightBorder).toBe("1px");
      expect(geometry.rightBorderColor).toBe(systemColor);
    } else {
      expect(geometry.bottomBorder).toBe("1px");
      expect(geometry.bottomBorderColor).toBe(systemColor);
    }
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const minimize = page.getByRole("button", { name: "Minimize window", exact: true });
    await expect(minimize).toBeFocused();
    expect(await minimize.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "solid",
    );
  }
});

for (const state of ["loading", "fallback"]) {
  test(`Archive Manager ${state} retains the content boundary and clears stacked empty navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 860, height: 620 });
    await page.goto(`/tests/browser/fixtures/?view=archive-shell&state=${state}`);
    const geometry = await shellGeometry(page);
    expect(geometry.mainLeft).toBe(geometry.sidebarRight);
    expect(geometry.mainTop).toBe(geometry.titlebarBottom);
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    await page.setViewportSize({ width: 480, height: 620 });
    await expect(page.locator(".archive-manager-window__sidebar")).toBeHidden();
    const narrow = await shellGeometry(page);
    expect(narrow.mainLeft).toBe(0);
    expect(narrow.mainTop).toBe(narrow.titlebarBottom);
    expect(narrow.horizontalOverflow).toBe(false);
    await expect(page.getByRole(state === "loading" ? "status" : "alert")).toBeVisible();
  });
}
