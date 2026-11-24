import { expect, test, type Locator } from "@playwright/test";

import { resolveTheme } from "../../src/themes/resolveTheme";
import { appThemeResolvedTokenRegistry } from "../../src/themes/themeTokenRegistry";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";
import { tokenRoleMarkup } from "./fixtures/token-roles";

async function compareStyles(probe: Locator, properties: Record<string, string>) {
  const { actual, legacy } = await probe.evaluate((element, properties) => {
    const reference = document.createElement("div");
    for (const [property, value] of Object.entries(properties)) {
      reference.style.setProperty(property, value);
    }
    element.parentElement?.append(reference);
    const read = (target: Element) => {
      const style = getComputedStyle(target);
      return Object.fromEntries(
        Object.keys(properties).map((property) => [property, style.getPropertyValue(property)]),
      );
    };
    const result = { actual: read(element), legacy: read(reference) };
    reference.remove();
    return result;
  }, properties);

  for (const property of Object.keys(properties)) {
    // Tailwind composes ring and inset shadows before the requested elevation.
    if (property === "box-shadow") expect(actual[property]).toContain(legacy[property]);
    else expect(actual[property], property).toBe(legacy[property]);
  }
}

test("desktop utility roles preserve legacy geometry and live theme scope", async ({ page }) => {
  const response = await page.request.get("/src/styles/index.css?direct");
  expect(response.ok()).toBe(true);
  await page.setContent(`<!doctype html><html lang="en"><body>${tokenRoleMarkup}</body></html>`);
  await page.addStyleTag({ content: await response.text() });

  const app = page.locator("#app-probe");
  const appColors = { "background-color": "var(--surface-main)", color: "var(--text)" };
  const appProperties = {
    ...appColors,
    "font-family": "var(--font-ui)",
    "font-size": "var(--type-control-label)",
    "font-weight": "var(--type-control-label-weight)",
    "line-height": "var(--type-control-label-line-height)",
    height: "var(--control-height-standard)",
    "border-top-width": "var(--border-width)",
    "border-top-style": "solid",
    "border-top-color": "var(--line)",
    "border-top-left-radius": "var(--radius-control)",
    "box-shadow": "var(--shadow-popover)",
  };

  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((root, theme) => {
      root.dataset.appTheme = theme;
    }, theme);
    await compareStyles(app, appProperties);
  }

  // A preview publishes its own resolved values, not a second global palette.
  const preview = resolveTheme(shellStressThemes.distinct).app;
  const previewVariables = Object.entries(appThemeResolvedTokenRegistry).map(
    ([key, definition]) => [
      definition.cssVariable,
      preview.tokens[key as keyof typeof preview.tokens],
    ],
  );
  await page.locator("#preview-scope").evaluate((scope, variables) => {
    for (const [key, value] of variables) scope.style.setProperty(key, value);
  }, previewVariables);
  const previewProbe = page.locator("#preview-probe");
  await compareStyles(previewProbe, { ...appColors, "box-shadow": "var(--shadow-popover)" });
  await expect(previewProbe).toHaveCSS("background-color", "rgb(34, 40, 78)");
  await compareStyles(page.locator("#app-in-reader"), {
    ...appColors,
    "font-size": "var(--type-control-label)",
  });
  await compareStyles(page.locator("#reader-probe"), {
    "background-color": "var(--reader-bg)",
    color: "var(--reader-text)",
    "border-top-color": "var(--reader-line)",
    "font-family": "var(--font-display)",
    "font-size": "var(--type-body)",
  });
  await expect(page.locator("#reader-probe")).toHaveCSS("background-color", "rgb(238, 229, 210)");
  await expect(page.locator("#reader-probe")).toHaveCSS("font-size", "13px");
  await expect(page.locator("#app-in-reader")).toHaveCSS("font-size", "14px");

  await page.locator("html").evaluate((root) => {
    root.style.fontSize = "24px";
    root.style.setProperty("--font-ui", '"Arial", var(--font-ui-default)');
    root.style.setProperty("--font-display", '"Georgia", var(--font-display-default)');
  });
  await compareStyles(app, appProperties);
  await expect(app).toHaveCSS("font-size", "21px");
  await expect(app).toHaveCSS("height", "36px");
  await expect(app).toHaveCSS("font-family", /^Arial,/);
  await expect(page.locator("#reader-probe")).toHaveCSS("font-family", /^Georgia,/);
  const density = page.locator("#density-probe");
  await expect(density).toHaveCSS("height", "20px");
  await page.locator("html").evaluate((root) => {
    root.dataset.density = "compact";
  });
  await expect(density).toHaveCSS("height", "16px");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  const motion = page.locator("#motion-probe");
  await expect(motion).toHaveCSS("transition-duration", "0s");
  await expect(motion).toHaveCSS("animation-name", "none");
  await page.locator("html").evaluate((root) => {
    root.dataset.motion = "on";
  });
  await expect(motion).toHaveCSS("transition-duration", "0.12s");
  await expect(motion).toHaveCSS("animation-name", "app-motion-view-content-in");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(motion).toHaveCSS("transition-duration", "0s");
  await expect(motion).toHaveCSS("animation-name", "none");
});
