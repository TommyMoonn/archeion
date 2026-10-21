import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { startUIStabilityCapture } from "./ui-stability-capture";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { applicationPresentation } from "../../src/themes/appearancePresentation";
import shellPalettes from "../../src/themes/appShellPalettes.json" with { type: "json" };
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

const fixture = "/tests/browser/fixtures/ui-stability.html";
const pendingCaptures = new Map<Page, () => Promise<unknown>>();
async function capture(page: Page, info: TestInfo) {
  const finish = await startUIStabilityCapture(page, info);
  const complete = (conditions: Record<string, unknown>) => {
    pendingCaptures.delete(page);
    return finish(conditions);
  };
  pendingCaptures.set(page, () => complete({ outcome: "failed before checkpoint" }));
  return complete;
}
test.afterEach(async ({ page }) => {
  await pendingCaptures.get(page)?.();
});

type Mode = "dark" | "light" | "system-light" | "system-dark" | "custom";
async function canonicalPrepaint(page: Page, mode: Mode, invalidCustom = false) {
  const light = mode === "light" || mode === "system-light";
  await page.emulateMedia({ colorScheme: light ? "light" : "dark" });
  const selection =
    mode === "custom"
      ? { kind: "custom" as const, id: "shell-distinct" }
      : mode.startsWith("system-")
        ? { kind: "system" as const }
        : { kind: "builtin" as const, id: light ? ("light" as const) : ("dark" as const) };
  const resolved =
    mode === "custom" && !invalidCustom
      ? resolveTheme(shellStressThemes.distinct).app
      : resolveBuiltInAppTheme(light ? "light" : "dark");
  const snapshot = {
    schemaVersion: 1,
    ...applicationPresentation(selection, 0, resolved, null),
    ...shellPalettes,
  };
  // Synthetic native protocol response; canonical App/store/catalog initialization still runs.
  await page.addInitScript((value) => {
    Object.defineProperty(window, "__ARCHEION_APPEARANCE_PREPAINT__", {
      value,
      configurable: false,
    });
  }, snapshot);
  return { color: rgb(resolved.tokens.main), base: resolved.base };
}
function rgb(hex: string) {
  return `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
}
async function ready(page: Page) {
  await expect(page.locator("html")).not.toHaveAttribute("data-appearance-pending");
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().ready)).toBe(true);
}

for (const theme of ["dark", "light", "system-light", "system-dark", "custom"] as const) {
  test(`${theme}: pre-JavaScript and true same-window reload retain the canonical canvas`, async ({
    page,
  }, info) => {
    const expected = await canonicalPrepaint(page, theme);
    const entry = `${fixture}?theme=${theme}&count=0&settingsDelay=800&themeDelay=800`;
    await page.goto(entry, {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    // The fixture's real browser router navigates to /. Reload the fixture entry,
    // not the unmocked production index reached through that history replacement.
    await page.evaluate((url) => history.replaceState(null, "", url), entry);
    await page.screenshot({ path: info.outputPath("before-refresh.png") });
    const finish = await capture(page, info);
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    await page.route("**/ui-stability-main.tsx*", async (route) => {
      await held;
      await route.continue();
    });
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("#appearance-startup")).toBeVisible();
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    await expect(page.locator("body")).toHaveCSS("background-color", expected.color);
    await page.screenshot({ path: info.outputPath("reload-before-app-javascript.png") });
    release();
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", expected.base);
    await expect(page.locator("#root")).not.toHaveAttribute("inert");
    const report = await finish({
      theme,
      reload: true,
      settingsDelay: 800,
      themeDelay: 800,
      prepaint: "canonical native presentation simulated",
    });
    const frames = report.probe.frames.filter((frame) => frame.palette.body !== null);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((frame) => frame.palette.body === expected.color)).toBe(true);
  });
}

for (const windowMode of ["about", "settings", "theme-manager", "archive-manager"]) {
  test(`${windowMode}: prepaint inherits canonical light presentation`, async ({ page }, info) => {
    const expected = await canonicalPrepaint(page, "light");
    const finish = await capture(page, info);
    await page.goto(`${fixture}?window=${windowMode}&theme=light&settingsDelay=800`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#appearance-startup")).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("background-color", expected.color);
    await ready(page);
    const report = await finish({ windowMode, theme: "light", shellReadyHandshake: "deferred" });
    const frames = report.probe.frames.filter((frame) => frame.palette.body);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.palette.body === expected.color)).toBe(true);
  });
}

for (const failure of ["missing", "corrupt", "timeout"]) {
  test(`custom ${failure}: explicit fallback remains stable and its notice is keyboard-dismissible`, async ({
    page,
  }, info) => {
    await canonicalPrepaint(page, "custom", failure !== "timeout");
    const finish = await capture(page, info);
    const query = failure === "timeout" ? "themeDelay=6500" : `themeFailure=${failure}`;
    await page.goto(`${fixture}?theme=custom&window=about&${query}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("status").filter({ hasText: "default theme" })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
    if (failure === "timeout") {
      await page.waitForTimeout(1800);
      await expect(page.locator("html")).not.toHaveCSS("--surface-main", "#22284e");
    }
    await page.getByRole("button", { name: "Dismiss theme notice" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Dismiss theme notice" })).toHaveCount(0);
    await finish({ failure, fallback: "built-in dark" });
  });
}

test("failed settings retain an explicit fallback and accessible diagnostic", async ({
  page,
}, info) => {
  await canonicalPrepaint(page, "light");
  const finish = await capture(page, info);
  await page.goto(`${fixture}?theme=light&window=about&settingsFailure=unavailable`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("status").filter({ hasText: "Appearance settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
  await expect(page.locator("#root")).not.toHaveAttribute("inert");
  await finish({ settingsFailure: "unavailable", fallback: "built-in dark with diagnostic" });
});

test("late preference hydration preserves fallback until explicit refresh recovery", async ({
  page,
}, info) => {
  await canonicalPrepaint(page, "light");
  const finish = await capture(page, info);
  await page.goto(`${fixture}?theme=light&window=about&settingsDelay=6500`, {
    waitUntil: "domcontentloaded",
  });
  const notice = page.getByRole("status").filter({ hasText: "Appearance settings" });
  await expect(notice).toBeVisible({ timeout: 7000 });
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.getStoredAppTheme()))
    .toEqual({ kind: "builtin", id: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
  await expect(notice).toBeVisible();
  await page.evaluate(() => window.uiStabilityFixture.recoverAppearance());
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "light");
  await expect(notice).toHaveCount(0);
  await finish({ preferenceDelay: 6500, explicitRecovery: true });
});

test("system change during prepaint is followed without overwriting the runtime handoff", async ({
  page,
}, info) => {
  await canonicalPrepaint(page, "system-dark");
  const finish = await capture(page, info);
  await page.goto(`${fixture}?theme=system-dark&window=about&settingsDelay=1600`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#appearance-startup")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    rgb(shellPalettes.light.background),
  );
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "light");
  await page.evaluate(() => window.uiStabilityFixture.setAppTheme({ kind: "builtin", id: "dark" }));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", "dark");
  await finish({ systemChangeDuringStartup: true, prepaintListenerRetired: true });
});

test("a newer choice wins while a secondary window resolves its startup custom read", async ({
  page,
}, info) => {
  await canonicalPrepaint(page, "custom");
  const finish = await capture(page, info);
  await page.goto(`${fixture}?window=settings&theme=custom&themeDelay=1600`, {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture?.themeReadStarted()))
    .toBe(true);
  const latestAt = await page.evaluate(async () => {
    await window.uiStabilityFixture.setAppTheme({ kind: "builtin", id: "light" });
    await window.uiStabilityFixture.setAppTheme({ kind: "builtin", id: "dark" });
    await window.uiStabilityFixture.setAppTheme({ kind: "builtin", id: "light" });
    return performance.now();
  });
  await page.waitForTimeout(1800);
  const report = await finish({ newest: "light", lateCustomReadObserved: true });
  const frames = report.probe.frames.filter(
    (frame) => frame.time >= latestAt && frame.palette.body,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame.palette.body === rgb(shellPalettes.light.background))).toBe(
    true,
  );
});
