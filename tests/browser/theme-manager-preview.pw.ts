import { expect, test, type Page } from "@playwright/test";

import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import type { ResolvedAppTheme } from "../../src/themes/domain";
import { appThemeResolvedTokenRegistry } from "../../src/themes/themeTokenRegistry";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

async function expectPreviewColors(page: Page, theme: ResolvedAppTheme) {
  const graphic = page.getByRole("img", { name: "Application shell preview", exact: true });
  await expect(graphic).toBeVisible();
  await expect(graphic).toHaveAccessibleDescription(/window chrome above navigation and workspace/);
  const actual = await graphic.evaluate((element) => {
    const probe = document.createElement("span");
    element.append(probe);
    const color = (variable: string) => {
      probe.style.color = `var(${variable})`;
      return getComputedStyle(probe).color;
    };
    const regions = {
      chrome: [".theme-shell-preview__chrome", "--theme-shell-frame"],
      navigation: [".theme-shell-preview__navigation", "--theme-shell-sidebar"],
      workspace: [".theme-shell-preview__workspace", "--theme-shell-main"],
      content: [".theme-shell-preview__content", "--theme-shell-surface-raised"],
    };
    const backgrounds = Object.values(regions).map(([selector, variable]) => ({
      rendered: getComputedStyle(element.querySelector(selector!)!).backgroundColor,
      resolved: color(variable!),
    }));
    const foregrounds = [
      [".theme-shell-preview__navigation", "--theme-shell-text", "color"],
      [".theme-shell-preview__workspace > strong", "--theme-shell-text-strong", "color"],
      [".theme-shell-preview__secondary", "--theme-shell-muted", "color"],
      [".theme-shell-preview__accent-mark", "--theme-shell-accent", "backgroundColor"],
    ].map(([selector, variable, property]) => ({
      rendered: getComputedStyle(element.querySelector(selector!)!)[
        property as "color" | "backgroundColor"
      ],
      resolved: color(variable!),
    }));
    const navigation = element.querySelector(".theme-shell-preview__navigation")!;
    const workspace = element.querySelector(".theme-shell-preview__workspace")!;
    const divider = getComputedStyle(navigation);
    const rtl = divider.direction === "rtl";
    const result = {
      backgrounds,
      foregrounds,
      divider:
        divider.borderInlineEndWidth === "1px"
          ? divider.borderInlineEndColor
          : divider.borderBlockEndColor,
      dividerColor: color("--theme-shell-line-subtle"),
      dividerWidth:
        divider.borderInlineEndWidth === "1px"
          ? divider.borderInlineEndWidth
          : divider.borderBlockEndWidth,
      vertical: divider.borderInlineEndWidth === "1px",
      navigationEnd: rtl
        ? navigation.getBoundingClientRect().left
        : navigation.getBoundingClientRect().right,
      workspaceStart: rtl
        ? workspace.getBoundingClientRect().right
        : workspace.getBoundingClientRect().left,
      navigationBottom: navigation.getBoundingClientRect().bottom,
      workspaceTop: workspace.getBoundingClientRect().top,
      frame: (element as HTMLElement).style.getPropertyValue("--theme-shell-frame"),
      sidebar: (element as HTMLElement).style.getPropertyValue("--theme-shell-sidebar"),
      main: (element as HTMLElement).style.getPropertyValue("--theme-shell-main"),
      raised: (element as HTMLElement).style.getPropertyValue("--theme-shell-surface-raised"),
      line: (element as HTMLElement).style.getPropertyValue("--theme-shell-line-subtle"),
      width: element.getBoundingClientRect().width,
      availableWidth: element.parentElement!.getBoundingClientRect().width,
    };
    probe.remove();
    return result;
  });
  expect(actual.backgrounds.every(({ rendered, resolved }) => rendered === resolved)).toBe(true);
  expect(actual.foregrounds.every(({ rendered, resolved }) => rendered === resolved)).toBe(true);
  expect(actual).toMatchObject({
    frame: theme.tokens.frame,
    sidebar: theme.tokens.sidebar,
    main: theme.tokens.main,
    raised: theme.tokens.surfaceRaised,
    line: theme.tokens.lineSubtle,
    dividerWidth: "1px",
  });
  expect(actual.divider).toBe(actual.dividerColor);
  if (actual.vertical) expect(actual.navigationEnd).toBe(actual.workspaceStart);
  else expect(actual.navigationBottom).toBe(actual.workspaceTop);
  expect(actual.width).toBeCloseTo(actual.availableWidth, 1);
  await expect(graphic.locator("button, a, input, [tabindex], nav, main, header")).toHaveCount(0);
  await expect(page.getByRole("definition")).toHaveCount(3);
}

test("candidate inspection renders resolved built-in and custom colors without applying them", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 660 });
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await expect(page.getByRole("button", { name: "Equal shell planes", exact: true })).toBeEnabled();
  const initial = await page.locator("html").getAttribute("style");
  for (const [name, theme] of [
    ["Archeion Dark", resolveBuiltInAppTheme("dark")],
    ["Archeion Light", resolveBuiltInAppTheme("light")],
    [shellStressThemes.equal.name, resolveTheme(shellStressThemes.equal).app],
    [shellStressThemes.distinct.name, resolveTheme(shellStressThemes.distinct).app],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expectPreviewColors(page, theme);
    await expect(page.getByRole("complementary", { name: "Theme preview controls" })).toHaveCount(
      0,
    );
    expect(await page.locator("html").getAttribute("style")).toBe(initial);
    await page.screenshot({ path: testInfo.outputPath(`${name.replaceAll(" ", "-")}.png`) });
  }
  await page.getByRole("button", { name: /^invalid-shell/ }).click();
  await expect(page.getByRole("img", { name: "Application shell preview" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Theme diagnostics");
});

test("static preview reflows at narrow widths and doubled text without adding keyboard stops", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await page.getByRole("button", { name: /^Equal shell planes/ }).click();
  for (const width of [320, 480, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("img", { name: "Application shell preview" }).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await expectPreviewColors(page, resolveTheme(shellStressThemes.equal).app);
    await page.screenshot({ path: testInfo.outputPath(`reflow-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: ".theme-shell-preview { --type-caption: 24px; }" });
  const preview = page.getByRole("img", { name: "Application shell preview" });
  await preview.scrollIntoViewIfNeeded();
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("doubled-text.png") });
  const remove = page.getByRole("button", { name: "Remove", exact: true });
  await remove.focus();
  const focusStops = await page.locator("button:not([disabled]), a[href]").count();
  for (let index = 0; index <= focusStops; index += 1) {
    await page.keyboard.press("Tab");
    expect(await preview.evaluate((element) => element.contains(document.activeElement))).toBe(
      false,
    );
  }
});

test("RTL and forced colors retain the structural divider and do not create pseudo-controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await page.getByRole("button", { name: /^Distinct shell planes/ }).click();
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  const graphic = page.getByRole("img", { name: "Application shell preview" });
  const boundary = async () =>
    graphic.evaluate((element) => {
      const navigation = element.querySelector(".theme-shell-preview__navigation")!;
      const workspace = element.querySelector(".theme-shell-preview__workspace")!;
      const style = getComputedStyle(navigation);
      return {
        navigationStart: navigation.getBoundingClientRect().left,
        workspaceEnd: workspace.getBoundingClientRect().right,
        borderWidth: style.borderInlineEndWidth,
        borderColor: style.borderInlineEndColor,
      };
    });
  const rtl = await boundary();
  expect(rtl.navigationStart).toBe(rtl.workspaceEnd);
  expect(rtl.borderWidth).toBe("1px");
  await page.screenshot({ path: testInfo.outputPath("rtl.png") });
  await page.emulateMedia({ forcedColors: "active" });
  const forced = await boundary();
  const systemColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(forced.borderColor).toBe(systemColor);
  expect(forced.borderWidth).toBe("1px");
  await expect(graphic.locator("button, [tabindex]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("forced-colors.png") });
});

test("warning acknowledgment, revert, keep, and removal remain deliberate workflows", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await page.getByRole("button", { name: /^Unreadable navigation/ }).click();
  const before = await page.locator("html").getAttribute("style");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const controls = page.getByRole("complementary", { name: "Theme preview controls" });
  await expect(controls.getByRole("button", { name: "Revert" })).toBeFocused();
  await expect(controls.getByRole("button", { name: "Use theme" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await controls.getByRole("button", { name: "Revert" }).click();
  await expect(controls).toHaveCount(0);
  expect(await page.locator("html").getAttribute("style")).toBe(before);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await controls.getByRole("checkbox").check();
  await controls.getByRole("button", { name: "Use theme" }).click();
  await expect(controls).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Unreadable navigation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Remove/ });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove theme" }).click();
  await expect(page.getByRole("button", { name: /^Unreadable navigation/ })).toHaveCount(0);
  // The committed missing ID remains inspectable as unavailable until replaced.
  await expect(page.getByRole("img", { name: "Application shell preview" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("could not be read");
  await page.getByRole("button", { name: /^Archeion Dark/ }).click();
  await expect(page.getByRole("img", { name: "Application shell preview" })).toBeVisible();
});

test("missing scoped candidate properties fall back to the host's canonical shell tokens", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await page.getByRole("button", { name: /^Distinct shell planes/ }).click();
  const graphic = page.getByRole("img", { name: "Application shell preview" });
  const hostStyle = await page.locator("html").getAttribute("style");
  const expectedRoles = [
    [".theme-shell-preview__chrome", appThemeResolvedTokenRegistry.frame.cssVariable],
    [".theme-shell-preview__navigation", appThemeResolvedTokenRegistry.sidebar.cssVariable],
    [".theme-shell-preview__workspace", appThemeResolvedTokenRegistry.main.cssVariable],
  ];
  const backgrounds = await graphic.evaluate((element, roles) => {
    const style = (element as HTMLElement).style;
    for (const property of Array.from(style)) {
      if (property.startsWith("--theme-shell-")) style.removeProperty(property);
    }
    const probe = document.createElement("span");
    element.append(probe);
    const result = roles.map(([selector, variable]) => {
      probe.style.backgroundColor = `var(${variable})`;
      return {
        rendered: getComputedStyle(element.querySelector(selector!)!).backgroundColor,
        host: getComputedStyle(probe).backgroundColor,
        defined: getComputedStyle(element).getPropertyValue(variable!).trim().length > 0,
      };
    });
    probe.remove();
    return result;
  }, expectedRoles);
  for (const background of backgrounds) {
    expect(background.defined).toBe(true);
    expect(background.rendered).toBe(background.host);
  }
  expect(await page.locator("html").getAttribute("style")).toBe(hostStyle);
});

test("details fill the pane, catalog insets stay compact, and swatch parts share a centerline", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/fixtures/?view=theme-manager");
  await page.getByRole("button", { name: /^Archeion Dark/ }).click();
  for (const direction of ["ltr", "rtl"]) {
    await page
      .locator("html")
      .evaluate((element, dir) => element.setAttribute("dir", dir), direction);
    for (const width of [320, 480, 900, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectPreviewColors(page, resolveBuiltInAppTheme("dark"));
      const metrics = await page.locator(".theme-manager-surface").evaluate((surface) => {
        const items = surface.querySelector(".theme-catalog-list__items")!;
        const row = items.querySelector("button")!;
        const insets = [items, row].flatMap((element) => {
          const style = getComputedStyle(element);
          return [parseFloat(style.paddingInlineStart), parseFloat(style.paddingInlineEnd)];
        });
        const center = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        };
        return {
          insets,
          rowHeight: row.getBoundingClientRect().height,
          swatches: [...surface.querySelectorAll(".theme-swatch")].map((swatch) => [
            center(swatch.querySelector("dt")!),
            center(swatch.querySelector("dd > span")!),
            center(swatch.querySelector("code")!),
          ]),
        };
      });
      expect(metrics.insets.every((inset) => inset <= 8)).toBe(true);
      expect(metrics.rowHeight).toBeGreaterThanOrEqual(48);
      for (const [label, chip, value] of metrics.swatches) {
        expect(label!).toBeCloseTo(chip!, 1);
        expect(value!).toBeCloseTo(chip!, 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.getByRole("img", { name: "Application shell preview" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`layout-${direction}-${width}.png`) });
    }
  }
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "ltr"));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: ".theme-details__swatches { --type-caption: 24px; }" });
  const swatches = page.locator(".theme-details__swatches");
  await swatches.scrollIntoViewIfNeeded();
  expect(await swatches.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("swatches-doubled-text.png") });
});
