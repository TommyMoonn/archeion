import { expect, test, type Page } from "@playwright/test";

import { resolveTheme } from "../../src/themes/resolveTheme";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

async function shellPresentation(page: Page, archive: boolean) {
  return page.evaluate((archive) => {
    const sidebar = document.querySelector<HTMLElement>(
      archive ? ".archive-manager-window__sidebar" : ".sidebar",
    )!;
    const main = document.querySelector<HTMLElement>(
      archive ? ".archive-manager-window__main" : ".page-shell",
    )!;
    const titlebar = document.querySelector<HTMLElement>(".window-titlebar")!;
    const plane = titlebar.querySelector<HTMLElement>(".window-titlebar__navigation-plane");
    const sidebarStyle = getComputedStyle(sidebar);
    const mainStyle = getComputedStyle(main);
    const probe = document.createElement("span");
    document.body.append(probe);
    const color = (variable: string) => {
      probe.style.color = `var(${variable})`;
      return getComputedStyle(probe).color;
    };
    const colors = {
      frame: color("--surface-app-frame"),
      sidebar: color("--surface-sidebar"),
      main: color("--surface-main"),
      divider: color("--line-subtle"),
    };
    probe.remove();
    return {
      colors,
      frameBackground: getComputedStyle(document.querySelector(".window-app")!).backgroundColor,
      titlebarBackground: getComputedStyle(titlebar).backgroundColor,
      titlebarBottom: titlebar.getBoundingClientRect().bottom,
      planeBackground: plane ? getComputedStyle(plane).backgroundColor : null,
      planeRight: plane?.getBoundingClientRect().right,
      planeDivider: plane ? getComputedStyle(plane, "::after").backgroundColor : null,
      sidebarBackground: sidebarStyle.backgroundColor,
      sidebarRight: sidebar.getBoundingClientRect().right,
      sidebarBottom: sidebar.getBoundingClientRect().bottom,
      mainBackground: mainStyle.backgroundColor,
      mainLeft: main.getBoundingClientRect().left,
      mainTop: main.getBoundingClientRect().top,
      mainBorders: [
        mainStyle.borderTopWidth,
        mainStyle.borderRightWidth,
        mainStyle.borderBottomWidth,
        mainStyle.borderLeftWidth,
      ],
      mainRadius: mainStyle.borderRadius,
      rightBorder: sidebarStyle.borderInlineEndWidth,
      rightBorderColor: sidebarStyle.borderInlineEndColor,
      bottomBorder: sidebarStyle.borderBlockEndWidth,
      bottomBorderColor: sidebarStyle.borderBlockEndColor,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, archive);
}

for (const theme of ["equal", "distinct"] as const) {
  for (const view of ["library", "archive-shell"] as const) {
    test(`${view} preserves resolved ${theme} schema-v1 shell roles`, async ({
      page,
    }, testInfo) => {
      const archive = view === "archive-shell";
      const resolved = resolveTheme(shellStressThemes[theme]);
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.goto(`/tests/browser/fixtures/?view=${view}&themeStress=${theme}`);
      await expect(
        page.locator(archive ? ".archive-manager-window__main" : ".page-shell"),
      ).toBeVisible();

      const variables = await page.locator("html").evaluate((root) => ({
        frame: root.style.getPropertyValue("--surface-app-frame"),
        sidebar: root.style.getPropertyValue("--surface-sidebar"),
        main: root.style.getPropertyValue("--surface-main"),
        lineSubtle: root.style.getPropertyValue("--line-subtle"),
        lineStrong: root.style.getPropertyValue("--line-strong"),
      }));
      expect(variables).toEqual({
        frame: resolved.app.tokens.frame,
        sidebar: resolved.app.tokens.sidebar,
        main: resolved.app.tokens.main,
        lineSubtle: resolved.app.tokens.lineSubtle,
        lineStrong: resolved.app.tokens.lineStrong,
      });

      const split = await shellPresentation(page, archive);
      expect(split.frameBackground).toBe(split.colors.frame);
      expect(split.sidebarBackground).toBe(split.colors.sidebar);
      expect(split.mainBackground).toBe(split.colors.main);
      expect(split.titlebarBackground).toBe(split.colors.main);
      expect(split.planeBackground).toBe(split.colors.sidebar);
      expect(split.planeRight).toBe(split.sidebarRight);
      expect(split.mainLeft).toBe(split.sidebarRight);
      expect(split.mainTop).toBe(split.titlebarBottom);
      expect(split.rightBorder).toBe("1px");
      expect(split.rightBorderColor).toBe(split.colors.divider);
      expect(split.planeDivider).toBe(split.colors.divider);
      expect(split.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
      expect(split.mainRadius).toBe("0px");
      expect(split.overflow).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${view}-split.png`) });

      if (!archive) {
        await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
        await expect(page.locator(".sidebar")).toHaveAttribute("data-collapsed", "true");
        await expect.poll(async () => (await shellPresentation(page, false)).planeRight).toBe(56);
        const collapsed = await shellPresentation(page, false);
        expect(collapsed.mainLeft).toBe(collapsed.sidebarRight);
        expect(collapsed.sidebarBackground).toBe(collapsed.colors.sidebar);
        expect(collapsed.planeDivider).toBe(collapsed.colors.divider);
        await page.getByRole("button", { name: "Enter Reader", exact: true }).click();
        await expect(page.locator(".window-titlebar")).toHaveCSS(
          "background-color",
          split.colors.frame,
        );
        await page.getByRole("button", { name: "Return to Library", exact: true }).click();
        await expect(page.locator(".window-titlebar")).toHaveCSS(
          "background-color",
          split.colors.main,
        );
      }

      for (const width of [480, 320]) {
        await page.setViewportSize({ width, height: 700 });
        // Resize-driven composition updates must settle before reading styles.
        await expect(page.locator(".window-titlebar")).toHaveCSS(
          "background-color",
          split.colors.frame,
        );
        const stacked = await shellPresentation(page, archive);
        expect(stacked.sidebarBackground).toBe(stacked.colors.sidebar);
        expect(stacked.mainBackground).toBe(stacked.colors.main);
        expect(stacked.mainTop).toBe(stacked.sidebarBottom);
        expect(stacked.mainLeft).toBe(0);
        expect(stacked.rightBorder).toBe("0px");
        expect(stacked.bottomBorder).toBe("1px");
        expect(stacked.bottomBorderColor).toBe(stacked.colors.divider);
        expect(stacked.mainBorders).toEqual(["0px", "0px", "0px", "0px"]);
        expect(stacked.overflow).toBe(false);
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${view}-stacked-${width}.png`),
        });
      }
    });
  }
}
