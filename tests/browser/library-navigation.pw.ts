import { expect, test } from "@playwright/test";

const destinations = ["Library", "Series", "Favorites", "Folders"];

for (const width of [320, 480, 560, 561, 1280]) {
  test(`Expanded Library navigation keeps visible names at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/tests/browser/fixtures/?view=library");
    const navigation = page.getByRole("navigation", { name: "Library navigation" });

    for (const name of destinations) {
      const destination = navigation.getByRole("button", { name, exact: true });
      await expect(destination.locator("span")).toBeVisible();
      await destination.focus();
      await expect(destination).toBeFocused();
      await expect(page.locator(".app-tooltip")).toHaveCount(0);
      const bounds = await destination.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }

    await expect(navigation.getByRole("button", { name: "Library", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await navigation.getByRole("button", { name: "Series", exact: true }).press("Enter");
    await expect(navigation.getByRole("button", { name: "Series", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await navigation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    if (width === 320) {
      await page.screenshot({ path: test.info().outputPath("library-navigation-320.png") });
    }
  });
}

for (const input of ["keyboard", "pointer"]) {
  test(`Collapsed Library navigation exposes every destination to ${input} users`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/tests/browser/fixtures/?view=library");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const navigation = page.getByRole("navigation", { name: "Library navigation" });
    if (input === "keyboard") {
      await page.keyboard.press("Shift+Tab");
      await navigation.getByRole("button", { name: destinations[0], exact: true }).focus();
    }

    for (const name of destinations) {
      const destination = navigation.getByRole("button", { name, exact: true });
      await expect(destination.locator("span")).toBeHidden();
      if (input === "keyboard") {
        await expect(destination).toBeFocused();
      } else {
        await destination.hover();
      }
      await expect(page.locator(".app-tooltip")).toHaveText(name);
      if (input === "keyboard") await page.keyboard.press("Tab");
    }
  });
}

for (const theme of ["light", "dark"]) {
  test(`Narrow Library navigation reflows with enlarged text in ${theme} appearance`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/tests/browser/fixtures/?view=library");
    await page.evaluate((appearance) => {
      document.documentElement.dataset.appTheme = appearance;
      document.documentElement.style.fontSize = "200%";
    }, theme);
    const navigation = page.getByRole("navigation", { name: "Library navigation" });
    for (const name of destinations) {
      const destination = navigation.getByRole("button", { name, exact: true });
      await expect(destination.locator("span")).toBeVisible();
      const labelFits = await destination.locator("span").evaluate((element) => {
        const label = element.getBoundingClientRect();
        const control = element.parentElement!.getBoundingClientRect();
        return (
          label.left >= control.left &&
          label.right <= control.right &&
          element.scrollWidth <= element.clientWidth
        );
      });
      expect(labelFits).toBe(true);
    }
    const lastDestination = await navigation
      .getByRole("button", { name: "Folders", exact: true })
      .boundingBox();
    const folderHeading = await page.locator(".sidebar__section-heading").boundingBox();
    expect(lastDestination).not.toBeNull();
    expect(folderHeading).not.toBeNull();
    expect(lastDestination!.y + lastDestination!.height).toBeLessThanOrEqual(folderHeading!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`library-navigation-${theme}-200.png`) });
  });
}
