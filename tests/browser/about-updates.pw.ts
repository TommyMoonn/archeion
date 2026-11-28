import { expect, test } from "@playwright/test";
import {
  isThemeColor,
  themeColorApcaContrast,
  themeColorContrastRatio,
} from "../../src/themes/themeColor";
const fixture = "/tests/browser/fixtures/index.html?view=about-updates";
const changelog = "https://tommymoonn.github.io/archeion/documentation/changelog/";
const candidate = {
  version: "1.6.1",
  notes: "Release prose stays outside About",
  publishedAt: null,
};

test("checking keeps one visible status, one live owner and the idle action footprint", async ({
  page,
}) => {
  await page.goto(fixture);
  const region = page.getByRole("region", { name: "Application updates" });
  const button = region.getByRole("button", { name: "Check for updates", exact: true });
  await expect(button).toBeEnabled();
  const before = await button.boundingBox();
  await page.evaluate(() => window.updateToastFixture!.set({ status: "checking" }));
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(region.locator(".about-update__message")).toHaveText("Checking for updates…");
  await expect(region.getByRole("status")).toHaveCount(1);
  await expect(region.getByRole("status")).toHaveText("Checking for updates…");
  await expect(region.getByRole("button", { name: "Checking…", exact: true })).toHaveCount(0);
  const during = await button.boundingBox();
  expect(during!.width).toBe(before!.width);
  expect(during!.height).toBe(before!.height);
  await page.evaluate(() => window.updateToastFixture!.set({ status: "idle" }));
  await expect(button).toBeEnabled();
  expect((await button.boundingBox())!.width).toBe(before!.width);
});
for (const appearance of ["dark", "light"] as const) {
  test(`simplified About keeps flat links and one primary action in ${appearance}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 520, height: 620 });
    await page.goto(`${fixture}${appearance === "light" ? "&light" : ""}`);
    const status = page.getByRole("region", { name: "Application updates", exact: true });
    const previewWindow = page.locator(".window-app--about");
    const heading = page.getByRole("heading", { name: "Archeion", exact: true });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(
      /serif/,
    );
    expect(await heading.evaluate((element) => getComputedStyle(element).fontSize)).toBe("30px");
    const logo = await page.locator("main .brand-logo img:visible").boundingBox();
    expect(logo!.width).toBe(64);
    expect(logo!.height).toBe(64);
    await expect(page.getByRole("button", { name: "Close window", exact: true })).toBeVisible();
    const links = page.getByRole("navigation", { name: "Archeion links" }).getByRole("link");
    await expect(links).toHaveCount(4);
    await page.evaluate(
      (candidate) => window.updateToastFixture!.set({ status: "available", available: candidate }),
      candidate,
    );
    await expect(status).toContainText("Archeion 1.6.1 is available");
    await expect(status.locator(".button--primary")).toHaveCount(1);
    await expect(status.getByRole("button")).toHaveCount(1);
    await expect(status.getByRole("button", { name: "Update now", exact: true })).toBeVisible();
    await expect(status.getByRole("button", { name: "Check for updates" })).toHaveCount(0);
    for (const link of await links.all()) {
      expect(await link.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
        "0px",
      );
      expect(await link.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
        "rgba(0, 0, 0, 0)",
      );
      await expect(link).toBeInViewport();
      const bounds = await link.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(620);
    }
    await previewWindow.screenshot({
      path: testInfo.outputPath(`simplified-about-available-${appearance}.png`),
    });
    await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
    await expect(status).toContainText("Restart Archeion to finish the update.");
    await expect(status.locator(".button--primary")).toHaveCount(1);
    await expect(status.getByRole("button", { name: "Restart now" })).toBeVisible();
    await expect(status.getByRole("button", { name: "Later", exact: true })).toBeVisible();
    await previewWindow.screenshot({
      path: testInfo.outputPath(`simplified-about-ready-${appearance}.png`),
    });
    await page.emulateMedia({ forcedColors: "active" });
    await status.getByRole("button", { name: "Restart now" }).focus();
    expect(
      await status
        .getByRole("button", { name: "Restart now" })
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2);
  });
}

test("About links keep keyboard focus and announce opener errors in forced colors", async ({
  page,
}) => {
  const websiteUrl = "https://tommymoonn.github.io/archeion/";
  await page.setViewportSize({ width: 520, height: 620 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await page.goto(`${fixture}&failExternalLink=${encodeURIComponent(websiteUrl)}`);
  const about = page.getByRole("main");
  const links = about.getByRole("navigation", { name: "Archeion links" });
  const website = links.getByRole("link", { name: /^Website/ });
  await about.getByRole("button", { name: "Check for updates" }).focus();
  await page.keyboard.press("Tab");
  await expect(website).toBeFocused();
  await expect(website).toHaveCSS("outline-style", "solid");
  await expect(website).toHaveCSS("outline-width", "2px");
  await expect(website).toHaveCSS("outline-offset", "2px");
  await page.keyboard.press("Enter");

  const error = about.getByRole("alert");
  await expect(error).toHaveText("Archeion could not open that link.");
  const systemErrorColors = await error.evaluate((element) => {
    const reference = document.createElement("span");
    reference.style.color = "CanvasText";
    reference.style.backgroundColor = "Mark";
    element.append(reference);
    const colors = getComputedStyle(reference);
    const result = { color: colors.color, background: colors.backgroundColor };
    reference.remove();
    return result;
  });
  await expect(error).toHaveCSS("color", systemErrorColors.color);
  await expect(error).toHaveCSS("background-color", systemErrorColors.background);
  await expect(website).toBeFocused();

  await links.getByRole("link", { name: /^Documentation/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-external-url",
    `${websiteUrl}documentation/`,
  );
  await expect(error).toHaveCount(0);
  await expect(links.getByRole("link", { name: /^Documentation/ })).toHaveCSS(
    "outline-style",
    "none",
  );
});

test.describe("About links on touch-primary devices", () => {
  test.use({ hasTouch: true });

  test("mouse hover highlights a project link", async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 620 });
    await page.goto(fixture);
    const website = page.getByRole("link", { name: /^Website/ });
    await expect(website).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    const hoverFill = await website.evaluate((element) => {
      const sample = document.createElement("span");
      sample.style.backgroundColor = "var(--surface-hover)";
      element.append(sample);
      const fill = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return fill;
    });

    await website.hover();
    await expect(website).toHaveCSS("background-color", hoverFill);
  });
});

function hex(rgb: string) {
  const channels = rgb
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unexpected color ${rgb}`);
  const color = `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
  if (!isThemeColor(color)) throw new Error(`Invalid color ${rgb}`);
  return color;
}
test("About supports manual outcomes, snoozed download and deferred restart through the shared client", async ({
  page,
}, testInfo) => {
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
  await page.setViewportSize({ width: 520, height: 620 });
  await page.goto(fixture);
  const status = page.getByRole("region", { name: "Application updates", exact: true });
  await page.evaluate(() => window.updateToastFixture!.setNoUpdate(true));
  await status.getByRole("button", { name: "Check for updates" }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toContainText("Archeion is up to date.");
  await page.evaluate(
    (candidate) =>
      window.updateToastFixture!.set({
        status: "available",
        available: candidate,
        prompt: {
          snoozedVersion: candidate.version,
          snoozedUntil: Date.now() + 86400000,
          restartDeferred: false,
          completedVersion: null,
        },
      }),
    candidate,
  );
  await expect(status).toContainText("Archeion 1.6.1 is available");
  await expect(status).not.toContainText(candidate.notes);
  await expect(status.getByRole("button", { name: "Check for updates" })).toHaveCount(0);
  const statusBounds = await status.boundingBox();
  const linkBounds = await status.getByRole("link", { name: /What's new/ }).boundingBox();
  expect(
    Math.abs(linkBounds!.x + linkBounds!.width / 2 - statusBounds!.x - statusBounds!.width / 2),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("about-available.png") });
  await status.getByRole("link", { name: /What's new/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-external-url",
    `${changelog}#release-1-6-1`,
  );
  await page.getByRole("link", { name: /^Changelog/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-last-external-url", changelog);
  await status.getByRole("button", { name: "Update now" }).click();
  await expect(status.getByRole("progressbar")).not.toHaveAttribute("value");
  await page.evaluate(() =>
    window.updateToastFixture!.set({ downloadedBytes: 46, totalBytes: 100 }),
  );
  await expect(status).toContainText("Downloading… 46%");
  await page.evaluate(() => window.updateToastFixture!.set({ status: "ready" }));
  await expect(status).toContainText("Restart Archeion to finish the update.");
  await page.screenshot({ path: testInfo.outputPath("about-ready.png") });
  await status.getByRole("button", { name: "Later", exact: true }).click();
  await expect(status.getByRole("button", { name: "Restart now" })).toBeEnabled();
  expect(await page.evaluate(() => window.updateToastFixture!.calls.install)).toBe(0);
  await status.getByRole("button", { name: "Restart now" }).focus();
  await page.keyboard.press("Space");
  await expect(status).toContainText("Restarting Archeion…");
  expect(await page.evaluate(() => window.updateToastFixture!.calls.install)).toBe(1);
  expect(errors).toEqual([]);
  expect(updaterRequests).toEqual([]);
});
test("About surfaces retryable manual failure and stays useful in an unsupported build", async ({
  page,
}) => {
  await page.goto(fixture);
  const status = page.getByRole("region", { name: "Application updates" });
  await page.evaluate(() => window.updateToastFixture!.failNext("check"));
  await status.getByRole("button", { name: "Check for updates" }).click();
  await expect(status).toContainText("Updates could not be checked. Try again.");
  await status.getByRole("button", { name: "Check for updates" }).click();
  await expect(status).toContainText("Archeion 1.6.1 is available");
  await page.evaluate(() => window.updateToastFixture!.set({ supported: false }));
  await expect(status).toContainText("Updates are unavailable in this build.");
  await expect(status.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Changelog/ })).toBeVisible();
});
for (const appearance of ["dark", "light"] as const) {
  for (const width of [320, 520]) {
    test(`About controls and links reflow at ${width}px in ${appearance} with 200% text`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 620 });
      await page.goto(`${fixture}${appearance === "light" ? "&light" : ""}`);
      await page.evaluate((candidate) => {
        document.documentElement.style.fontSize = "200%";
        window.updateToastFixture!.set({ status: "available", available: candidate });
      }, candidate);
      const status = page.getByRole("region", { name: "Application updates" });
      const update = status.getByRole("button", { name: "Update now" });
      await update.scrollIntoViewIfNeeded();
      await page.keyboard.press("Tab");
      await update.focus();
      const colors = await update.evaluate((element) => {
        const button = getComputedStyle(element);
        const region = getComputedStyle(element.closest("main")!);
        return {
          text: button.color,
          fill: button.backgroundColor,
          ring: button.outlineColor,
          behind: region.backgroundColor,
          outline: button.outlineWidth,
        };
      });
      expect(
        themeColorContrastRatio(hex(colors.text), hex(colors.fill), hex(colors.behind), appearance),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        Math.abs(
          themeColorApcaContrast(
            hex(colors.text),
            hex(colors.fill),
            hex(colors.behind),
            appearance,
          ),
        ),
      ).toBeGreaterThanOrEqual(60);
      expect(
        themeColorContrastRatio(
          hex(colors.ring),
          hex(colors.behind),
          hex(colors.behind),
          appearance,
        ),
      ).toBeGreaterThanOrEqual(3);
      expect(Number.parseFloat(colors.outline)).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const action of await status.getByRole("button").all()) {
        const bounds = await action.boundingBox();
        expect(bounds!.width).toBeLessThanOrEqual(width - 32);
        expect(bounds!.height).toBeGreaterThanOrEqual(24);
      }
      await page.screenshot({ path: testInfo.outputPath(`about-${appearance}-${width}-200.png`) });
      await page.getByRole("link", { name: /^Source code/ }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("link", { name: /^Source code/ })).toBeInViewport();
      await update.click();
      await expect(status).toContainText("Downloading…");
    });
  }
}
test("completion waits for the first Library visit and pauses for hover and focus without repeating", async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/tests/browser/fixtures/index.html?view=library-updates&completed&readerStartup",
  );
  await expect(page.getByRole("heading", { name: "Reader fixture" })).toBeVisible();
  const notice = page.getByRole("region", { name: "Application update", exact: true });
  await expect(notice).toHaveCount(0);
  expect(await page.evaluate(() => window.updateToastFixture!.acknowledgements)).toBe(0);
  await page.getByRole("button", { name: "Return to Library" }).click();
  await expect(notice).toContainText("Updated to Archeion 1.6.1");
  await expect(notice.getByRole("button", { name: "Dismiss update confirmation" })).toBeVisible();
  expect(await notice.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.evaluate(() => window.updateToastFixture!.acknowledgements)).toBe(1);
  await page.clock.fastForward(3000);
  await notice.hover();
  const releaseNotesButton = notice.getByRole("button", { name: "View release notes" });
  await releaseNotesButton.focus();
  await page.clock.fastForward(20000);
  await expect(notice).toBeVisible();
  await page.mouse.move(300, 100);
  await page.clock.fastForward(10000);
  await expect(notice).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("completed-update.png") });
  await releaseNotesButton.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-last-external-url",
    `${changelog}#release-1-6-1`,
  );
  await page.getByRole("button", { name: "Enter Reader", exact: true }).focus();
  expect(await notice.evaluate((element) => element.matches(":hover"))).toBe(true);
  await page.mouse.move(300, 100);
  expect(await notice.evaluate((element) => element.matches(":hover"))).toBe(false);
  expect(await notice.evaluate((element) => element.matches(":focus-within"))).toBe(false);
  await page.clock.fastForward(4999);
  await expect(notice).toBeVisible();
  await page.clock.fastForward(1);
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "Enter Reader", exact: true }).click();
  await page.getByRole("button", { name: "Return to Library" }).click();
  await expect(notice).toHaveCount(0);
});
