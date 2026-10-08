import { expect, test, type Page } from "@playwright/test";
import {
  isThemeColor,
  themeColorApcaContrast,
  themeColorContrastRatio,
} from "../../src/themes/themeColor";

function hexColor(rgb: string) {
  const channels = rgb
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unexpected rendered color: ${rgb}`);
  const hex = `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  if (!isThemeColor(hex)) throw new Error(`Invalid rendered color: ${rgb}`);
  return hex;
}

const fixtureUrl = "/tests/browser/fixtures/index.html?view=library-updates";
async function available(page: Page) {
  await page.evaluate(() =>
    window.updateToastFixture!.set({
      status: "available",
      available: { version: "1.6.1", notes: null, publishedAt: null },
    }),
  );
}
test("Library discovery is polite and keyboard-operated, while Reader retains shared state without a notice", async ({
  page,
}) => {
  const errors: string[] = [];
  const updaterRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("github.com") || request.url().includes("latest.json"))
      updaterRequests.push(request.url());
  });
  await page.goto(fixtureUrl);
  const reader = page.getByRole("button", { name: "Enter Reader", exact: true });
  await reader.focus();
  const liveRegion = page.getByRole("status");
  await expect(liveRegion).toBeEmpty();
  await available(page);
  await expect(reader).toBeFocused();
  await expect(liveRegion).toHaveAttribute("aria-live", "polite");
  await expect(liveRegion).toHaveText("Archeion 1.6.1 is available");
  const toast = page.getByRole("region", { name: "Application update", exact: true });
  await expect(toast.getByRole("button")).toHaveCount(2);
  const link = toast.getByRole("link", { name: /What's new.*1.6.1/ });
  await link.focus();
  await page.keyboard.press("Tab");
  await expect(toast.getByRole("button", { name: "Later", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("main")).toBeFocused();
  await page.evaluate(() => {
    const client = window.updateToastFixture!;
    client.set({ available: { version: "1.6.2", notes: null, publishedAt: null } });
  });
  await expect(toast).toBeVisible();
  await reader.click();
  await expect(page.getByRole("heading", { name: "Reader fixture" })).toBeVisible();
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
  await page.getByRole("button", { name: "Return to Library" }).click();
  await expect(toast).toHaveText(/Restart Archeion to finish the update\./);
  await expect(toast).not.toContainText("1.6.2");
  await expect(toast.getByRole("link")).toHaveCount(0);
  await toast.getByRole("button", { name: "Restart now" }).focus();
  await page.keyboard.press("Space");
  await expect(toast).toHaveText("Restarting Archeion…");
  expect(await page.evaluate(() => window.updateToastFixture!.calls.install)).toBe(1);
  expect(errors).toEqual([]);
  expect(updaterRequests).toEqual([]);
});

test("download and recovery replace the notice in place without inventing progress or installing automatically", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await available(page);
  const toast = page.getByRole("region", { name: "Application update" });
  await toast.getByRole("button", { name: "Update now" }).click();
  await expect(toast).toContainText("Downloading…");
  await expect(toast.getByRole("progressbar")).not.toHaveAttribute("value");
  await expect(toast).toBeFocused();
  await page.evaluate(() =>
    window.updateToastFixture!.set({ downloadedBytes: 46, totalBytes: 100 }),
  );
  await expect(toast).toContainText("Downloading… 46%");
  await expect(toast.getByRole("progressbar")).toHaveAttribute("value", "46");
  await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
  await expect(toast).toContainText("Restart Archeion to finish the update.");
  expect(await page.evaluate(() => window.updateToastFixture!.calls.install)).toBe(0);
  await toast.getByRole("button", { name: "Later", exact: true }).click();
  await expect(toast).toHaveCount(0);
  await page.getByRole("button", { name: "Enter Reader" }).click();
  await page.getByRole("button", { name: "Return to Library" }).click();
  await expect(toast).toHaveCount(0);
  await page.evaluate(() =>
    window.updateToastFixture!.set({
      status: "available",
      prompt: {
        snoozedVersion: null,
        snoozedUntil: null,
        restartDeferred: false,
        completedVersion: null,
      },
      error: { operation: "download", message: "The update could not be downloaded. Try again." },
    }),
  );
  await expect(toast).toContainText("The update could not be downloaded.");
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(toast).toContainText("Downloading…");
  expect(await page.evaluate(() => window.updateToastFixture!.calls.download)).toBe(2);
});

test("failed installation and fresh-check recovery remain explicit without reusing installation", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await available(page);
  await page.evaluate(() => {
    window.updateToastFixture!.set({ status: "ready" });
    window.updateToastFixture!.failNext("install");
  });
  const toast = page.getByRole("region", { name: "Application update" });
  await toast.getByRole("button", { name: "Restart now" }).click();
  await expect(toast).toContainText("The update could not be installed.");
  await page.evaluate(() => window.updateToastFixture!.failNext("check"));
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(toast).toContainText("Updates could not be checked. Try again.");
  await expect(toast.getByRole("button", { name: "Later", exact: true })).toBeVisible();
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(toast).toContainText("Archeion 1.6.1 is available");
  expect(await page.evaluate(() => window.updateToastFixture!.calls)).toEqual({
    check: 2,
    download: 0,
    install: 1,
    defer: 0,
  });
});

for (const width of [1280, 800, 560, 360, 320]) {
  test(`notice fits the Library viewport at ${width}px and does not obscure final content or modal overlays`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixtureUrl);
    await available(page);
    const toast = page.getByRole("region", { name: "Application update" });
    const main = page.getByRole("main");
    const bounds = await toast.boundingBox();
    const mainBounds = await main.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(mainBounds!.x + 10);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 10);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(790);
    for (const button of await toast.getByRole("button").all()) {
      const buttonBounds = await button.boundingBox();
      expect(buttonBounds!.height).toBeGreaterThanOrEqual(24);
      expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    }
    // The shared focus owner deliberately distinguishes keyboard from programmatic focus.
    await page.keyboard.press("Tab");
    await toast.getByRole("button", { name: "Update now" }).focus();
    const indicator = await toast
      .getByRole("button", { name: "Update now" })
      .evaluate((element) => ({
        width: getComputedStyle(element).outlineWidth,
        style: getComputedStyle(element).outlineStyle,
      }));
    expect(Number.parseFloat(indicator.width)).toBeGreaterThanOrEqual(2);
    expect(indicator.style).not.toBe("none");
    await page.screenshot({ path: testInfo.outputPath(`update-available-${width}.png`) });
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const last = page.getByRole("button", { name: "Last Library action" });
    const lastBounds = await last.boundingBox();
    expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(bounds!.y);
    await last.click();
    const scrollToast = await toast.boundingBox();
    expect(scrollToast!.y).toBeCloseTo(bounds!.y, 0);
    await page.getByRole("button", { name: "Open Library overlay" }).click();
    const dialog = page.getByRole("dialog", { name: "Library overlay" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(toast.getByRole("button", { name: "Later", exact: true })).not.toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("reduced-motion and forced-colors keep the notice usable", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(fixtureUrl);
  await available(page);
  const toast = page.getByRole("region", { name: "Application update" });
  await expect(toast).toBeVisible();
  expect(await toast.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await toast.getByRole("button", { name: "Update now" }).focus();
  await page.screenshot({ path: testInfo.outputPath("update-forced-colors.png") });
  await page.keyboard.press("Enter");
  await expect(toast).toContainText("Downloading…");
});

test("notice text and keyboard indicators retain contrast in both built-in appearances", async ({
  page,
}, testInfo) => {
  for (const appearance of ["dark", "light"] as const) {
    await page.goto(`${fixtureUrl}${appearance === "light" ? "&light" : ""}`);
    await available(page);
    await page.keyboard.press("Tab");
    const toast = page.getByRole("region", { name: "Application update" });
    await toast.getByRole("button", { name: "Update now" }).focus();
    const colors = await toast.evaluate((element) => {
      const style = getComputedStyle(element);
      const link = getComputedStyle(element.querySelector("a")!);
      const button = getComputedStyle(element.querySelector(".button--primary")!);
      return {
        background: style.backgroundColor,
        title: getComputedStyle(element.querySelector("p")!).color,
        link: link.color,
        ring: button.outlineColor,
        primaryText: button.color,
        primaryBackground: button.backgroundColor,
      };
    });
    const background = hexColor(colors.background);
    const pairs = {
      title: [hexColor(colors.title), background],
      link: [hexColor(colors.link), background],
      ring: [hexColor(colors.ring), background],
      primaryText: [hexColor(colors.primaryText), hexColor(colors.primaryBackground)],
    } as const;
    const measurements = Object.fromEntries(
      Object.entries(pairs).map(([name, [foreground, behind]]) => [
        name,
        {
          ratio: themeColorContrastRatio(foreground, behind, background, appearance),
          apcaLc: Math.abs(themeColorApcaContrast(foreground, behind, background, appearance)),
        },
      ]),
    );
    for (const [name, result] of Object.entries(measurements)) {
      expect(result.ratio, JSON.stringify({ colors, measurements })).toBeGreaterThanOrEqual(
        name === "ring" ? 3 : 4.5,
      );
      expect(result.apcaLc, JSON.stringify({ colors, measurements })).toBeGreaterThanOrEqual(
        name === "ring" ? 30 : 60,
      );
    }
    await testInfo.attach(`${appearance}-update-contrast`, {
      body: JSON.stringify({ colors, measurements }, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`update-${appearance}.png`) });
  }
});

test("notice survives 200% text resizing and wraps long versions without clipping actions", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 640 });
  await page.goto(fixtureUrl);
  await available(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    window.updateToastFixture!.set({
      available: { version: "123456789.123456789.123456789", notes: null, publishedAt: null },
    });
  });
  const toast = page.getByRole("region", { name: "Application update" });
  await expect(toast).toBeVisible();
  expect(await toast.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await toast.getByRole("button", { name: "Update now" }).click();
  await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
  await expect(toast).toContainText("Restart Archeion to finish the update.");
  await expect(toast.getByRole("button", { name: "Restart now" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("update-ready-text-200.png") });
  await toast.getByRole("button", { name: "Restart now" }).click();
  await expect(toast).toHaveText("Restarting Archeion…");
});
