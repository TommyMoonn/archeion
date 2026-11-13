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
      error: null,
      prompt: {
        snoozedVersion: null,
        snoozedUntil: null,
        restartDeferred: false,
        completedVersion: null,
      },
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
  // The polite announcer is intentionally screen-reader-only, so include hidden roles.
  const liveRegion = page.getByRole("status", { includeHidden: true });
  await expect(liveRegion).toBeEmpty();
  await available(page);
  await expect(reader).toBeFocused();
  await expect(liveRegion).toHaveAttribute("aria-live", "polite");
  await expect(liveRegion).toHaveText("Archeion 1.6.1 is available");
  const toast = page.getByRole("region", { name: "Application update", exact: true });
  await expect(toast.getByRole("button")).toHaveCount(2);
  await expect(toast.getByRole("link")).toHaveCount(0);
  const dismissButton = toast.getByRole("button", {
    name: "Dismiss update notice",
    exact: true,
  });
  const updateButton = toast.getByRole("button", { name: "Update now", exact: true });
  await dismissButton.focus();
  await page.keyboard.press("Tab");
  await expect(updateButton).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dismissButton).toBeFocused();
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
  await expect(toast.getByRole("progressbar", { name: "Restarting Archeion" })).toBeVisible();
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
  await toast.getByRole("button", { name: "Dismiss update notice", exact: true }).click();
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
  await expect(
    toast.getByRole("button", { name: "Dismiss update notice", exact: true }),
  ).toBeVisible();
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(toast).toContainText("Archeion 1.6.1 is available");
  expect(await page.evaluate(() => window.updateToastFixture!.calls)).toEqual({
    check: 2,
    download: 0,
    install: 1,
    defer: 0,
  });
});

test("update notices use two rows, compact actions, and app styling", async ({ page }) => {
  await page.goto(fixtureUrl);
  await available(page);
  const toast = page.getByRole("region", { name: "Application update" });
  const availableStyles = await toast.evaluate((element) => {
    const actionRow = element.querySelector<HTMLElement>(":scope > .update-toast__actions")!;
    const primary = actionRow.querySelector<HTMLElement>(".button--primary")!;
    const dismiss = element.querySelector<HTMLElement>(".update-toast__dismiss")!;
    const accentProbe = document.createElement("span");
    accentProbe.style.backgroundColor = "var(--accent)";
    element.append(accentProbe);
    const accent = getComputedStyle(accentProbe).backgroundColor;
    accentProbe.remove();
    const header = element.querySelector<HTMLElement>(".update-toast__header")!;
    const message = element.querySelector<HTMLElement>(".update-toast__message")!;
    const messageBounds = message.getBoundingClientRect();
    const dismissBounds = dismiss.getBoundingClientRect();
    return {
      toastWidth: Math.round(element.getBoundingClientRect().width),
      headerAlignment: getComputedStyle(header).alignItems,
      messageCenterY: messageBounds.top + messageBounds.height / 2,
      messageHeight: messageBounds.height,
      messageLineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
      dismissCenterY: dismissBounds.top + dismissBounds.height / 2,
      headerGap: getComputedStyle(header).gap,
      rowGap: getComputedStyle(element).rowGap,
      primaryWidth: Math.round(primary.getBoundingClientRect().width),
      primaryHeight: Math.round(primary.getBoundingClientRect().height),
      dismissHeight: Math.round(dismiss.getBoundingClientRect().height),
      dismissSlotWidth: getComputedStyle(dismiss.querySelector(".icon-slot")!).width,
      dismissGlyphWidth: getComputedStyle(dismiss.querySelector("svg")!).width,
      actionsJustification: getComputedStyle(actionRow).justifyContent,
      actionsLeft: Math.round(actionRow.getBoundingClientRect().left),
      messageLeft: Math.round(message.getBoundingClientRect().left),
      actionsTop: Math.round(actionRow.getBoundingClientRect().top),
      headerBottom: Math.round(header.getBoundingClientRect().bottom),
      primaryBackground: getComputedStyle(primary).backgroundColor,
      accent,
      primaryIcon: Boolean(primary.querySelector(".button__icon svg")),
      dismissIcon: Boolean(dismiss.querySelector("svg")),
    };
  });
  expect(availableStyles.toastWidth).toBe(360);
  expect(availableStyles.headerGap).toBe("24px");
  expect(availableStyles.messageHeight).toBeLessThanOrEqual(availableStyles.messageLineHeight + 1);
  expect(availableStyles.headerAlignment).toBe("center");
  expect(Math.abs(availableStyles.messageCenterY - availableStyles.dismissCenterY)).toBeLessThan(1);
  expect(availableStyles.rowGap).toBe("4px");
  expect(availableStyles.primaryWidth).toBeLessThan(140);
  expect(availableStyles.primaryHeight).toBe(32);
  expect(availableStyles.dismissHeight).toBe(32);
  expect(availableStyles.dismissSlotWidth).toBe("16px");
  expect(availableStyles.dismissGlyphWidth).toBe("14px");
  expect(availableStyles.actionsJustification).toBe("flex-start");
  expect(availableStyles.actionsLeft).toBe(availableStyles.messageLeft);
  expect(availableStyles.actionsTop - availableStyles.headerBottom).toBe(4);
  expect(availableStyles.primaryBackground).toBe(availableStyles.accent);
  expect(availableStyles.primaryIcon).toBe(true);
  expect(availableStyles.dismissIcon).toBe(true);

  await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
  await expect(toast.getByRole("button", { name: "Restart now" })).toBeVisible();
  const restartAlignment = await toast.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".update-toast__header")!;
    const actions = element.querySelector<HTMLElement>(".update-toast__actions")!;
    const primary = actions.querySelector<HTMLElement>(".button")!;
    const message = header.querySelector<HTMLElement>(".update-toast__message")!;
    const dismiss = header.querySelector<HTMLElement>(".update-toast__dismiss")!;
    const messageBounds = message.getBoundingClientRect();
    const dismissBounds = dismiss.getBoundingClientRect();
    return {
      toastWidth: Math.round(element.getBoundingClientRect().width),
      headerAlignment: getComputedStyle(header).alignItems,
      messageCenterY: messageBounds.top + messageBounds.height / 2,
      messageHeight: messageBounds.height,
      messageLineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
      dismissCenterY: dismissBounds.top + dismissBounds.height / 2,
      headerGap: getComputedStyle(header).gap,
      actionsTop: Math.round(actions.getBoundingClientRect().top),
      headerBottom: Math.round(header.getBoundingClientRect().bottom),
      primaryHeight: Math.round(primary.getBoundingClientRect().height),
      justification: getComputedStyle(actions).justifyContent,
    };
  });
  expect(restartAlignment.toastWidth).toBe(360);
  expect(restartAlignment.headerGap).toBe("24px");
  expect(restartAlignment.messageHeight).toBeLessThanOrEqual(
    restartAlignment.messageLineHeight + 1,
  );
  expect(restartAlignment.headerAlignment).toBe("center");
  expect(Math.abs(restartAlignment.messageCenterY - restartAlignment.dismissCenterY)).toBeLessThan(
    1,
  );
  expect(restartAlignment.actionsTop - restartAlignment.headerBottom).toBe(4);
  expect(restartAlignment.primaryHeight).toBe(32);
  expect(restartAlignment.justification).toBe("flex-start");

  await page.evaluate(() =>
    window.updateToastFixture!.set({
      status: "idle",
      currentVersion: "1.8.0",
      available: null,
      prompt: {
        snoozedVersion: null,
        snoozedUntil: null,
        restartDeferred: false,
        completedVersion: "1.8.0",
      },
    }),
  );
  await expect(toast).toHaveAttribute("data-state", "completed");
  const completedStyles = await toast.evaluate((element) => {
    const header = element.querySelector<HTMLElement>(".update-toast__header")!;
    const actions = element.querySelector<HTMLElement>(".update-toast__actions")!;
    const release = element.querySelector<HTMLElement>(".update-toast__release-button")!;
    const dismiss = element.querySelector<HTMLElement>(".update-toast__dismiss")!;
    const headerBounds = header.getBoundingClientRect();
    const actionsBounds = actions.getBoundingClientRect();
    const message = element.querySelector<HTMLElement>(".update-toast__message")!;
    const messageBounds = message.getBoundingClientRect();
    const dismissBounds = dismiss.getBoundingClientRect();
    return {
      bodyFont: getComputedStyle(document.body).fontFamily,
      messageFont: getComputedStyle(element.querySelector(".update-toast__message")!).fontFamily,
      releaseButtonFont: getComputedStyle(release).fontFamily,
      statusIcon: Boolean(element.querySelector(".update-toast__status-icon svg")),
      releaseIcon: Boolean(release.querySelector("svg")),
      releaseHeight: Math.round(release.getBoundingClientRect().height),
      dismissHeight: Math.round(dismiss.getBoundingClientRect().height),
      releaseInHeader: header.contains(release),
      releaseInActions: actions.contains(release),
      toastWidth: Math.round(element.getBoundingClientRect().width),
      headerAlignment: getComputedStyle(header).alignItems,
      messageCenterY: messageBounds.top + messageBounds.height / 2,
      messageHeight: messageBounds.height,
      messageLineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
      dismissCenterY: dismissBounds.top + dismissBounds.height / 2,
      headerGap: getComputedStyle(header).gap,
      actionsBelowHeader: actionsBounds.top >= headerBounds.bottom,
      rowGap: getComputedStyle(element).rowGap,
    };
  });
  expect(completedStyles.messageFont).toBe(completedStyles.bodyFont);
  expect(completedStyles.releaseButtonFont).toBe(completedStyles.bodyFont);
  expect(completedStyles.statusIcon).toBe(false);
  expect(completedStyles.releaseIcon).toBe(true);
  expect(completedStyles.toastWidth).toBe(360);
  expect(completedStyles.headerGap).toBe("24px");
  expect(completedStyles.messageHeight).toBeLessThanOrEqual(completedStyles.messageLineHeight + 1);
  expect(completedStyles.headerAlignment).toBe("center");
  expect(Math.abs(completedStyles.messageCenterY - completedStyles.dismissCenterY)).toBeLessThan(1);
  expect(completedStyles.rowGap).toBe("4px");
  expect(completedStyles.releaseHeight).toBe(32);
  expect(completedStyles.dismissHeight).toBe(32);
  expect(completedStyles.releaseInHeader).toBe(false);
  expect(completedStyles.releaseInActions).toBe(true);
  expect(completedStyles.actionsBelowHeader).toBe(true);
});

test("restart notice expands to fit a monospaced interface font before wrapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(fixtureUrl);
  await available(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--font-ui", '"SF Mono", monospace');
    window.updateToastFixture!.set({ status: "ready" });
  });

  const toast = page.getByRole("region", { name: "Application update" });
  await expect(toast).toBeVisible();
  const layout = await toast.evaluate((element) => {
    const message = element.querySelector<HTMLElement>(".update-toast__message")!;
    const dismiss = element.querySelector<HTMLElement>(".update-toast__dismiss")!;
    const messageBounds = message.getBoundingClientRect();
    const dismissBounds = dismiss.getBoundingClientRect();
    return {
      fontFamily: getComputedStyle(message).fontFamily,
      toastWidth: Math.round(element.getBoundingClientRect().width),
      messageHeight: messageBounds.height,
      messageLineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
      messageClientWidth: message.clientWidth,
      messageScrollWidth: message.scrollWidth,
      dismissLeft: dismissBounds.left,
      messageRight: messageBounds.right,
    };
  });

  expect(layout.fontFamily).toContain("monospace");
  expect(layout.toastWidth).toBeGreaterThan(360);
  expect(layout.toastWidth).toBeLessThanOrEqual(440);
  expect(layout.messageHeight).toBeLessThanOrEqual(layout.messageLineHeight + 1);
  expect(layout.messageScrollWidth).toBeLessThanOrEqual(layout.messageClientWidth + 1);
  expect(layout.dismissLeft - layout.messageRight).toBeGreaterThanOrEqual(23);
});

test("completion uses two rows and a working dismiss control", async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.evaluate(() =>
    window.updateToastFixture!.set({
      status: "idle",
      currentVersion: "1.8.0",
      available: null,
      prompt: {
        snoozedVersion: null,
        snoozedUntil: null,
        restartDeferred: false,
        completedVersion: "1.8.0",
      },
    }),
  );

  const toast = page.getByRole("region", { name: "Application update" });
  await expect(toast).toContainText("Updated to Archeion 1.8.0");
  await expect(toast.getByRole("button", { name: "View release notes" })).toBeVisible();
  await expect(toast.locator(":scope > .update-toast__header")).toHaveCount(1);
  await expect(toast.locator(":scope > .update-toast__header .update-toast__dismiss")).toHaveCount(
    1,
  );
  await expect(
    toast.locator(":scope > .update-toast__actions .update-toast__release-button"),
  ).toHaveCount(1);
  await expect(toast.locator(".update-toast__status-icon")).toHaveCount(0);
  await toast.getByRole("button", { name: "View release notes" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-external-url",
    "https://tommymoonn.github.io/archeion/documentation/changelog/#release-1-8-0",
  );
  await toast.getByRole("button", { name: "Dismiss update confirmation" }).click();
  await expect(toast).toHaveCount(0);
});

for (const width of [1280, 800, 560, 360, 320]) {
  test(`notice is a compact overlay at ${width}px without resizing the Library or covering modal overlays`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixtureUrl);
    const main = page.getByRole("main");
    const mainBefore = await main.boundingBox();
    await available(page);
    const toast = page.getByRole("region", { name: "Application update" });
    await expect(toast).toBeVisible();
    const bounds = await toast.boundingBox();
    const mainBounds = await main.boundingBox();
    expect(mainBounds).toEqual(mainBefore);
    expect(
      await page
        .locator(".page-shell-notice")
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("absolute");
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
    await expect(last).toBeVisible();
    const scrollToast = await toast.boundingBox();
    expect(scrollToast!.y).toBeCloseTo(bounds!.y, 0);
    await toast.getByRole("button", { name: "Dismiss update notice", exact: true }).click();
    await expect(toast).toHaveCount(0);
    await last.click();
    await available(page);
    await page.getByRole("button", { name: "Open Library overlay" }).click();
    const dialog = page.getByRole("dialog", { name: "Library overlay" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      toast.getByRole("button", { name: "Dismiss update notice", exact: true }),
    ).not.toBeFocused();
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
      const dismiss = getComputedStyle(element.querySelector(".update-toast__dismiss")!);
      const button = getComputedStyle(element.querySelector(".button--primary")!);
      return {
        background: style.backgroundColor,
        title: getComputedStyle(element.querySelector("p")!).color,
        dismiss: dismiss.color,
        ring: button.outlineColor,
        primaryText: button.color,
        primaryBackground: button.backgroundColor,
      };
    });
    const background = hexColor(colors.background);
    const pairs = {
      title: [hexColor(colors.title), background],
      dismiss: [hexColor(colors.dismiss), background],
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
