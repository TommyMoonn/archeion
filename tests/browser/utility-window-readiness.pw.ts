import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const fixture = "/tests/browser/fixtures/ui-stability.html";
const windows = [
  { mode: "about", module: "AboutWindow", title: "About Archeion" },
  { mode: "settings", module: "StandaloneSettingsWindow", title: "Settings" },
  { mode: "theme-manager", module: "ThemeManagerWindow", title: "Theme Manager" },
  { mode: "archive-manager", module: "ArchiveManagerWindow", title: "Archive Manager" },
];

for (const { mode, module, title } of windows) {
  test(`${mode}: shell reveals while its feature import is held, then keeps chrome on completion`, async ({
    page,
  }, info) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/${module}.tsx*`, async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto(
        `${fixture}?window=${mode}&windowInstance=7&theme=light&settingsDelay=350&themeDelay=800`,
        { waitUntil: "commit" },
      );
      await expect(
        page.getByRole("heading", { name: mode === "about" ? "Archeion" : title, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Close window", exact: true })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => window.uiStabilityFixture.utilityEvents.length))
        .toBe(2);
      const chrome = page.locator(".window-titlebar");
      const before = await chrome.boundingBox();
      await chrome.evaluate((node) => {
        node.setAttribute("data-instance-test", "original");
      });
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
      await page.screenshot({ path: info.outputPath("shell-before-feature.png") });
      release();
      await expect(page.getByText(`Opening ${title}`, { exact: true })).toHaveCount(0);
      await expect(chrome).toHaveAttribute("data-instance-test", "original");
      expect(await chrome.boundingBox()).toEqual(before);
      const events = await page.evaluate(() => window.uiStabilityFixture.utilityEvents);
      expect(events.map((event) => event.kind)).toEqual(["shell-ready", "native-show"]);
      expect(events.every((event) => event.shell)).toBe(true);
      expect(events[1].time).toBeGreaterThanOrEqual(events[0].time);
      const readinessPath = info.outputPath("readiness-order.json");
      await writeFile(
        readinessPath,
        JSON.stringify(
          {
            events,
            milestones: await page.evaluate(() =>
              performance
                .getEntriesByType("mark")
                .filter((entry) => entry.name.startsWith("archeion:utility:"))
                .map((entry) => ({ name: entry.name, time: entry.startTime })),
            ),
            native: "mocked IPC; no compositor proof",
          },
          null,
          2,
        ),
      );
      await info.attach("readiness-order.json", {
        path: readinessPath,
        contentType: "application/json",
      });
      expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
    } finally {
      release();
    }
  });
}

test("a stalled feature import becomes a recoverable error inside the original chrome", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/StandaloneSettingsWindow.tsx*", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.clock.install();
    await page.goto(`${fixture}?window=settings&windowInstance=8&settingsDelay=0`, {
      waitUntil: "commit",
    });
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.clock.fastForward(10_100);
    await expect(page.getByRole("alert")).toContainText("Reload this window to try again");
    await expect(page.getByRole("button", { name: "Reload window" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close window", exact: true })).toBeVisible();
  } finally {
    release();
  }
});

test("a failed feature import retains native controls and an accessible error", async ({
  page,
}) => {
  await page.route("**/AboutWindow.tsx*", (route) => route.abort());
  await page.goto(`${fixture}?window=about&windowInstance=9&settingsDelay=0`, {
    waitUntil: "commit",
  });
  await expect(page.getByRole("alert")).toContainText("About Archeion could not be loaded");
  await expect(page.getByRole("button", { name: "Close window", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.utilityEvents.length))
    .toBe(2);
});
