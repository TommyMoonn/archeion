import { expect, test } from "@playwright/test";

async function libraryShellGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    const main = document.querySelector<HTMLElement>(".page-shell")!;
    const titlebar = document.querySelector<HTMLElement>(".window-titlebar")!;
    const plane = titlebar.querySelector<HTMLElement>(".window-titlebar__navigation-plane");
    const sidebarStyle = getComputedStyle(sidebar);
    const mainStyle = getComputedStyle(main);
    const planeStyle = plane ? getComputedStyle(plane, "::after") : null;
    const sidebarRect = sidebar.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return {
      sidebarRight: sidebarRect.right,
      sidebarBottom: sidebarRect.bottom,
      mainLeft: mainRect.left,
      mainTop: mainRect.top,
      mainRight: mainRect.right,
      titlebarRight: titlebar.getBoundingClientRect().right,
      planeRight: plane?.getBoundingClientRect().right,
      titlebarBackground: getComputedStyle(titlebar).backgroundColor,
      planeBackground: plane ? getComputedStyle(plane).backgroundColor : null,
      sidebarBackground: sidebarStyle.backgroundColor,
      mainBackground: mainStyle.backgroundColor,
      mainBorders: [
        mainStyle.borderTopWidth,
        mainStyle.borderRightWidth,
        mainStyle.borderBottomWidth,
        mainStyle.borderLeftWidth,
      ],
      mainRadius: mainStyle.borderRadius,
      mainOverflow: mainStyle.overflowY,
      sidebarRightBorder: sidebarStyle.borderRightWidth,
      sidebarBottomBorder: sidebarStyle.borderBottomWidth,
      sidebarBorderColor: sidebarStyle.borderInlineEndColor,
      dividerWidth: planeStyle?.width,
      dividerColor: planeStyle?.backgroundColor,
    };
  });
}

for (const shellColors of ["equal", "distinct"]) {
  test(`Library aligns expanded and collapsed split planes with ${shellColors} shell colors`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/tests/browser/fixtures/?view=library&shellColors=${shellColors}`);
    for (const collapsed of [false, true]) {
      if (collapsed) await page.getByRole("button", { name: "Collapse sidebar" }).click();
      const geometry = await libraryShellGeometry(page);
      expect(geometry.planeRight).toBe(geometry.sidebarRight);
      expect(geometry.mainLeft).toBe(geometry.sidebarRight);
      expect(geometry.mainRight).toBe(geometry.titlebarRight);
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
      expect(geometry.mainOverflow).toBe("auto");
      expect(geometry.sidebarRightBorder).toBe("1px");
      expect(geometry.sidebarBottomBorder).toBe("0px");
      expect(geometry.dividerWidth).toBe("1px");
      expect(geometry.dividerColor).toBe(geometry.sidebarBorderColor);
      const dragHit = await page.evaluate(() => {
        const plane = document
          .querySelector(".library-titlebar-composition")!
          .getBoundingClientRect();
        return document
          .elementFromPoint(plane.right - 2, plane.top + plane.height / 2)
          ?.hasAttribute("data-tauri-drag-region");
      });
      expect(dragHit).toBe(true);
      const toggle = page.getByRole("button", {
        name: collapsed ? "Expand sidebar" : "Collapse sidebar",
      });
      expect(
        await toggle.evaluate((button) => button.closest("[data-tauri-drag-region]")),
      ).toBeNull();
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`${shellColors}-${collapsed ? "collapsed" : "expanded"}.png`),
      });
    }
  });

  test(`Library stacks flat planes with a horizontal divider for ${shellColors} shell colors`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.goto(`/tests/browser/fixtures/?view=library&shellColors=${shellColors}`);
    const geometry = await libraryShellGeometry(page);
    expect(geometry.mainTop).toBe(geometry.sidebarBottom);
    expect(geometry.mainLeft).toBe(0);
    expect(geometry.sidebarRightBorder).toBe("0px");
    expect(geometry.sidebarBottomBorder).toBe("1px");
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.mainRadius).toBe("0px");
    expect(geometry.titlebarBackground).toBe(
      shellColors === "equal" ? "rgb(32, 32, 32)" : "rgb(72, 24, 48)",
    );
    await expect(page.locator('[data-window-titlebar-presentation="split"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${shellColors}-stacked.png`) });
  });
}

test("Library split presentation leaves Reader on frame chrome and returns without stale content", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=library&shellColors=distinct");
  await expect(page.locator(".window-titlebar")).toHaveCSS("background-color", "rgb(34, 40, 78)");
  await page.getByRole("button", { name: "Enter Reader" }).click();
  await expect(page.locator('[data-window-titlebar-presentation="split"]')).toHaveCount(0);
  await expect(page.locator(".library-titlebar-composition")).toHaveCount(0);
  await expect(page.locator(".window-titlebar")).toHaveCSS("background-color", "rgb(72, 24, 48)");
  await page.getByRole("button", { name: "Return to Library" }).click();
  await expect(page.locator('[data-window-titlebar-presentation="split"]')).toHaveCount(1);
  await expect(page.locator(".window-titlebar")).toHaveCSS("background-color", "rgb(34, 40, 78)");
});

test("forced colors preserve vertical and stacked Library dividers without enclosing the workspace", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/tests/browser/fixtures/?view=library&shellColors=equal");
  for (const width of [1280, 480]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('[data-window-titlebar-presentation="split"]')).toHaveCount(
      width > 560 ? 1 : 0,
    );
    const geometry = await libraryShellGeometry(page);
    expect(geometry.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(geometry.mainRadius).toBe("0px");
    expect(geometry.sidebarRightBorder).toBe(width > 560 ? "1px" : "0px");
    expect(geometry.sidebarBottomBorder).toBe(width > 560 ? "0px" : "1px");
    expect(geometry.sidebarBorderColor).not.toBe("rgba(0, 0, 0, 0)");
    if (width > 560) expect(geometry.dividerColor).toBe(geometry.sidebarBorderColor);
  }
});

test("Reader progress exposes the committed value after keyboard seeking", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=reader", { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("slider", { name: "Reading progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await progress.focus();
  await progress.press("ArrowRight");
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await expect(progress).toHaveAttribute("aria-valuetext", "33% · Chapter One");
  await page.getByRole("button", { name: "After progress" }).focus();
  await expect(progress).toHaveAttribute("aria-valuenow", "33");
  await expect(progress).toHaveAttribute("aria-valuetext", "33% · Chapter One");
});

test("Reader hover and drag preview preserve committed semantics until seek commits", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=reader", { waitUntil: "domcontentloaded" });

  const progress = page.getByRole("slider", { name: "Reading progress" });
  const fill = progress.locator(".reader-progress__fill");
  const preview = progress.locator(".reader-progress__preview");
  const bounds = await progress.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  await page.mouse.move(bounds!.x + bounds!.width * 0.75, y);

  await expect(preview).toContainText("75%");
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await expect(progress).toHaveAttribute("aria-valuetext", "32% · Chapter One");
  await expect(fill).toHaveAttribute("style", "width: 32%;");

  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.6, y);
  await expect(preview).toContainText("60%");
  await expect(progress).toHaveAttribute("aria-valuenow", "32");
  await expect(progress).toHaveAttribute("aria-valuetext", "32% · Chapter One");
  await expect(fill).toHaveAttribute("style", "width: 32%;");

  await page.mouse.up();
  await expect(progress).toHaveAttribute("aria-valuenow", "60");
  await expect(progress).toHaveAttribute("aria-valuetext", "60% · Chapter One");
  await expect(fill).toHaveAttribute("style", /width: 60(?:\.0+)?%;/);

  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "After progress" }).focus();
  await expect(preview).toHaveCount(0);
  await expect(progress).toHaveAttribute("aria-valuenow", "60");
});

test("narrow Library navigation keeps names and positions its collapsed tooltip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto("/tests/browser/fixtures/?view=library", { waitUntil: "domcontentloaded" });

  const navigation = page.getByRole("navigation", { name: "Library navigation" });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const series = navigation.getByRole("button", { name: "Series" });
  await expect(series.locator("span")).toBeHidden();
  await series.hover();

  const tooltip = page.locator(".app-tooltip");
  await expect(tooltip).toHaveText("Series");
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(700);

  await page.setViewportSize({ width: 480, height: 800 });
  await expect(series).toBeVisible();
  await expect(series.locator("span")).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Library" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(series.locator("span")).toBeHidden();
  await page.keyboard.press("Tab");
  await series.focus();
  await expect(tooltip).toHaveText("Series");
});

test("Dialog moves focus inside and returns it to its opener on Escape", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=dialog", { waitUntil: "domcontentloaded" });

  const opener = page.getByRole("button", { name: "Open sample dialog" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Sample dialog" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});
