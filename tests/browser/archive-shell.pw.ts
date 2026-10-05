import { expect, test, type Page } from "@playwright/test";

async function shellGeometry(page: Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".archive-manager-window__sidebar")!;
    const main = document.querySelector<HTMLElement>(".archive-manager-window__main")!;
    const titlebar = document.querySelector<HTMLElement>(".window-titlebar")!;
    const plane = titlebar.querySelector<HTMLElement>(".window-titlebar__navigation-plane")!;
    const sidebarStyle = getComputedStyle(sidebar);
    const mainStyle = getComputedStyle(main);
    const dividerStyle = getComputedStyle(plane, "::after");
    const sidebarRect = sidebar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const titlebarRect = titlebar.getBoundingClientRect();
    return {
      sidebarRight: sidebarRect.right,
      sidebarBottom: sidebarRect.bottom,
      mainLeft: mainRect.left,
      mainTop: mainRect.top,
      mainRight: mainRect.right,
      titlebarRight: titlebarRect.right,
      titlebarBottom: titlebarRect.bottom,
      titlebarHeight: titlebarRect.height,
      planeRight: plane.getBoundingClientRect().right,
      planeDisplay: getComputedStyle(plane).display,
      titlebarBackground: getComputedStyle(titlebar).backgroundColor,
      sidebarBackground: sidebarStyle.backgroundColor,
      planeBackground: getComputedStyle(plane).backgroundColor,
      mainBackground: mainStyle.backgroundColor,
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
      dividerWidth: dividerStyle.width,
      dividerColor: dividerStyle.backgroundColor,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

for (const shellColors of ["equal", "distinct"]) {
  test(`Archive Manager has continuous flat split planes with ${shellColors} colors`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 860, height: 620 });
    await page.goto(`/tests/browser/fixtures/?view=archive-shell&shellColors=${shellColors}`);
    const geometry = await shellGeometry(page);
    expect(geometry.sidebarRight).toBe(286);
    expect(geometry.planeRight).toBe(geometry.sidebarRight);
    expect(geometry.mainLeft).toBe(geometry.sidebarRight);
    expect(geometry.mainTop).toBe(geometry.titlebarBottom);
    expect(geometry.mainRight).toBe(geometry.titlebarRight);
    expect(geometry.titlebarHeight).toBe(32);
    expect(geometry.titlebarBackground).toBe(geometry.mainBackground);
    expect(geometry.planeBackground).toBe(geometry.sidebarBackground);
    expect(geometry.sidebarBackground).toBe(
      shellColors === "equal" ? "rgb(32, 32, 32)" : "rgb(18, 60, 56)",
    );
    expect(geometry.mainBackground).toBe(
      shellColors === "equal" ? "rgb(32, 32, 32)" : "rgb(34, 40, 78)",
    );
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.mainRadius).toBe("0px");
    expect(geometry.rightBorder).toBe("1px");
    expect(geometry.bottomBorder).toBe("0px");
    expect(geometry.dividerWidth).toBe("1px");
    expect(geometry.dividerColor).toBe(geometry.rightBorderColor);
    expect(geometry.dividerColor).toBe("rgb(85, 85, 85)");
    expect(geometry.horizontalOverflow).toBe(false);
    // The internal action card remains a bordered, rounded panel.
    const actions = await page.locator(".archive-manager-window__actions").evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderTopWidth, radius: style.borderTopLeftRadius };
    });
    expect(actions.border).toBe("1px");
    expect(actions.radius).not.toBe("0px");
    await page.screenshot({ path: testInfo.outputPath(`${shellColors}-split.png`) });
  });

  test(`Archive Manager stacks flat planes and ordinary chrome with ${shellColors} colors`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/tests/browser/fixtures/?view=archive-shell&shellColors=${shellColors}`);
    for (const width of [760, 480, 320]) {
      await page.setViewportSize({ width, height: 620 });
      const geometry = await shellGeometry(page);
      expect(geometry.planeDisplay).toBe("none");
      expect(geometry.mainTop).toBe(geometry.sidebarBottom);
      expect(geometry.mainLeft).toBe(0);
      expect(geometry.rightBorder).toBe("0px");
      expect(geometry.bottomBorder).toBe("1px");
      expect(geometry.bottomBorderColor).toBe("rgb(85, 85, 85)");
      expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
      expect(geometry.mainRadius).toBe("0px");
      expect(geometry.titlebarBackground).toBe(
        shellColors === "equal" ? "rgb(32, 32, 32)" : "rgb(72, 24, 48)",
      );
      expect(geometry.horizontalOverflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${shellColors}-stacked-${width}.png`) });
    }
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

test("Archive Manager forced colors preserve only the structural boundary", async ({
  page,
}, testInfo) => {
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
      expect(geometry.dividerColor).toBe(systemColor);
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
    await page.screenshot({ path: testInfo.outputPath(`forced-colors-${width}.png`) });
  }
});

for (const deviceScaleFactor of [1, 1.25, 1.5]) {
  test(`Archive Manager split boundary aligns at DPR ${deviceScaleFactor}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      deviceScaleFactor,
      viewport: { width: 860, height: 620 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/tests/browser/fixtures/?view=archive-shell");
      const geometry = await shellGeometry(page);
      expect(geometry.planeRight).toBe(geometry.sidebarRight);
      expect(geometry.mainLeft).toBe(geometry.sidebarRight);
      expect(geometry.mainTop).toBe(geometry.titlebarBottom);
      expect(geometry.rightBorder).toBe("1px");
      expect(geometry.dividerWidth).toBe("1px");
    } finally {
      await context.close();
    }
  });
}

for (const state of ["loading", "fallback"]) {
  test(`Archive Manager ${state} retains the same split geometry and clears stacked empty navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 860, height: 620 });
    await page.goto(`/tests/browser/fixtures/?view=archive-shell&state=${state}`);
    const geometry = await shellGeometry(page);
    expect(geometry.planeRight).toBe(286);
    expect(geometry.mainLeft).toBe(286);
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    await page.setViewportSize({ width: 480, height: 620 });
    await expect(page.locator(".archive-manager-window__sidebar")).toBeHidden();
    expect((await shellGeometry(page)).planeDisplay).toBe("none");
    await expect(page.getByRole(state === "loading" ? "status" : "alert")).toBeVisible();
  });
}
