import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { applicationPresentation } from "../../src/themes/appearancePresentation";
import shellPalettes from "../../src/themes/appShellPalettes.json" with { type: "json" };
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

const fixture = "/tests/browser/fixtures/ui-stability.html";

const windows = [
  {
    mode: "about",
    module: "AboutWindow",
    slot: "identity",
    plane: ".about-window-shell",
    width: 520,
    height: 620,
  },
  {
    mode: "settings",
    module: "StandaloneSettingsWindow",
    slot: "navigation",
    plane: ".settings-window",
    width: 1000,
    height: 760,
  },
  {
    mode: "theme-manager",
    module: "ThemeManagerWindow",
    slot: "workspace",
    plane: ".theme-manager-surface",
    width: 1100,
    height: 780,
  },
  {
    mode: "archive-manager",
    module: "ArchiveManagerWindow",
    slot: null,
    plane: ".archive-manager-window__main",
    width: 1100,
    height: 760,
  },
] as const;

async function canonicalPrepaint(page: Page, theme: "dark" | "light" | "custom") {
  await page.emulateMedia({ colorScheme: theme === "light" ? "light" : "dark" });
  const selection =
    theme === "custom"
      ? { kind: "custom" as const, id: "shell-distinct" }
      : { kind: "builtin" as const, id: theme };
  const resolved =
    theme === "custom"
      ? resolveTheme(shellStressThemes.distinct).app
      : resolveBuiltInAppTheme(theme);
  await page.addInitScript(
    (value) => {
      Object.defineProperty(window, "__ARCHEION_APPEARANCE_PREPAINT__", { value });
    },
    {
      schemaVersion: 1,
      ...applicationPresentation(selection, 0, resolved, null),
      ...shellPalettes,
    },
  );
}

async function geometry(page: Page, plane: string) {
  return page.evaluate((selector) => {
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const root = getComputedStyle(document.documentElement);
    const resolvedColor = (token: string) => {
      const node = document.createElement("span");
      node.style.color = `var(${token})`;
      document.body.append(node);
      const color = getComputedStyle(node).color;
      node.remove();
      return color;
    };
    return {
      titlebar: rect(document.querySelector(".window-titlebar")!),
      main: rect(document.querySelector("main")!),
      plane: {
        ...rect(document.querySelector(selector)!),
        color: getComputedStyle(document.querySelector(selector)!).backgroundColor,
      },
      slots: Object.fromEntries(
        [...document.querySelectorAll("[data-utility-slot]")].map((node) => [
          node.getAttribute("data-utility-slot"),
          rect(node),
        ]),
      ),
      tokens: {
        canvas: resolvedColor("--canvas"),
        main: resolvedColor("--surface-main"),
        canvasDeep: resolvedColor("--canvas-deep"),
        base: root.getPropertyValue("color-scheme"),
      },
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  }, plane);
}

for (const theme of ["dark", "light", "custom"] as const)
  for (const utility of windows) {
    test(`${utility.mode}/${theme}: destination geometry and planes survive import and hydration`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: utility.width, height: utility.height });
      await canonicalPrepaint(page, theme);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**/${utility.module}.tsx*`, async (route) => {
        await held;
        await route.continue();
      });
      try {
        await page.goto(
          `${fixture}?window=${utility.mode}&windowInstance=7&theme=${theme}&settingsDelay=350&themeDelay=100`,
          { waitUntil: "commit" },
        );
        await expect
          .poll(() => page.evaluate(() => window.uiStabilityFixture?.utilityEvents.length))
          .toBe(2);
        await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
        await expect(page.locator(".reader-status-page")).toHaveCount(0);
        await expect(page.locator("main").getByRole("button")).toHaveCount(0);
        await expect(page.locator("main").getByRole("link")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Close window", exact: true })).toBeVisible();
        const selectors = [
          ".window-titlebar",
          ...(utility.slot ? [`[data-utility-slot=${utility.slot}]`] : []),
        ];
        for (const selector of selectors)
          await page
            .locator(selector)
            .evaluate((node) => node.setAttribute("data-persistent-test", "original"));
        const before = await geometry(page, utility.plane);
        expect(before.documentHeight).toBe(before.viewportHeight);
        expect(before.plane.color).toBe(
          utility.mode === "about" || utility.mode === "archive-manager"
            ? before.tokens.main
            : before.tokens.canvas,
        );
        if (utility.mode === "settings") expect(before.slots.navigation.width).toBe(213);
        // The custom palette intentionally has distinct planes. Do not flatten them.
        if (theme === "custom") expect(before.tokens.main).not.toBe(before.tokens.canvasDeep);
        await page.screenshot({ path: info.outputPath("01-reveal-eligible-pre-import.png") });
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator("main")).toBeFocused();
        if (utility.mode === "settings" || utility.mode === "theme-manager")
          await page.evaluate(() => window.uiStabilityFixture.holdUtilityInitialization());
        release();
        if (utility.mode === "settings" || utility.mode === "theme-manager") {
          await expect(page.locator(".utility-window-ready .utility-load-status")).toBeVisible();
          await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
          const during = await geometry(page, utility.plane);
          expect(during).toEqual(before);
          await page.screenshot({
            path: info.outputPath("02-during-preference-initialization.png"),
          });
          await page.evaluate(() => window.uiStabilityFixture.releaseUtilityInitialization());
        }
        await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
        await expect(page.locator(".utility-load-status")).toHaveCount(0);
        for (const selector of selectors)
          await expect(page.locator(selector)).toHaveAttribute("data-persistent-test", "original");
        const after = await geometry(page, utility.plane);
        expect(after.titlebar).toEqual(before.titlebar);
        expect(after.main).toEqual(before.main);
        expect(after.plane).toEqual(before.plane);
        if (utility.mode === "settings") expect(after.slots.content).toEqual(before.slots.content);
        if (utility.mode === "theme-manager")
          expect(after.slots.workspace).toEqual(before.slots.workspace);
        if (utility.mode === "about") expect(after.slots.identity).toEqual(before.slots.identity);
        expect(after.documentHeight).toBe(after.viewportHeight);
        await expect(page.locator(".window-titlebar")).toHaveCount(1);
        await expect(page.locator(".reader-status-page")).toHaveCount(0);
        await page.screenshot({ path: info.outputPath("03-content-ready.png") });
        await writeFile(
          info.outputPath("geometry-and-planes.json"),
          JSON.stringify(
            { theme, before, after, native: "mocked reveal eligibility, not compositor evidence" },
            null,
            2,
          ),
        );
        // A warm same-document render keeps the existing chrome and does not acknowledge again.
        await page.evaluate(() =>
          window.uiStabilityFixture.setAppTheme(window.uiStabilityFixture.getStoredAppTheme()),
        );
        expect(
          (await page.evaluate(() => window.uiStabilityFixture.utilityEvents)).map(
            (event) => event.kind,
          ),
        ).toEqual(["shell-ready", "native-show"]);
        await page.getByRole("button", { name: "Close window", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => window.uiStabilityState!().nativeVisible))
          .toBe(false);
        expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
      } finally {
        release();
      }
    });
  }

for (const utility of windows) {
  test(`${utility.mode}: rejected import preserves the destination frame and reloads`, async ({
    page,
  }, info) => {
    await canonicalPrepaint(page, "light");
    await page.setViewportSize({ width: utility.width, height: utility.height });
    let imports = 0;
    await page.route(`**/${utility.module}.tsx*`, async (route) => {
      if (++imports === 1) await route.abort();
      else await route.continue();
    });
    await page.goto(
      `${fixture}?window=${utility.mode}&windowInstance=10&theme=light&settingsDelay=0`,
      { waitUntil: "commit" },
    );
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    await expect
      .poll(() => page.evaluate(() => window.uiStabilityFixture?.utilityEvents.length))
      .toBe(2);
    await expect(page.locator(".reader-status-page")).toHaveCount(0);
    await expect(page.locator(utility.plane)).toBeVisible();
    if (utility.slot)
      await expect(page.locator(`[data-utility-slot=${utility.slot}]`)).toBeVisible();
    const before = await geometry(page, utility.plane);
    await page.screenshot({ path: info.outputPath("08-import-rejection.png") });
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "Reload window", exact: true }).click(),
    ]);
    await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
    expect((await geometry(page, utility.plane)).plane).toEqual(before.plane);
    await expect(page.locator(".window-titlebar")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.uiStabilityFixture.utilityEvents.map((event) => event.kind)),
      )
      .toEqual(["shell-ready"]);
  });

  test(`${utility.mode}: indefinitely pending import recovers by a new document`, async ({
    page,
  }, info) => {
    await canonicalPrepaint(page, "dark");
    await page.setViewportSize({ width: utility.width, height: utility.height });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let imports = 0;
    await page.route(`**/${utility.module}.tsx*`, async (route) => {
      if (++imports === 1) {
        await held;
        await route.abort();
      } else await route.continue();
    });
    try {
      await page.clock.install();
      await page.goto(`${fixture}?window=${utility.mode}&windowInstance=8&settingsDelay=0`, {
        waitUntil: "commit",
      });
      await expect
        .poll(() => page.evaluate(() => window.uiStabilityFixture?.utilityEvents.length))
        .toBe(2);
      await page
        .locator(".window-titlebar")
        .evaluate((node) => node.setAttribute("data-persistent-test", "original"));
      const before = await geometry(page, utility.plane);
      await page.clock.fastForward(10_100);
      await expect(page.getByRole("alert")).toContainText("could not be loaded");
      await expect(page.locator(".window-titlebar")).toHaveAttribute(
        "data-persistent-test",
        "original",
      );
      expect((await geometry(page, utility.plane)).plane).toEqual(before.plane);
      await page.screenshot({ path: info.outputPath("04-stalled-import-error.png") });
      const reload = page.getByRole("button", { name: "Reload window", exact: true });
      // Reach recovery through normal keyboard order from the persistent skip link.
      await page.getByRole("link", { name: "Skip to content" }).focus();
      for (
        let i = 0;
        i < 6 && !(await reload.evaluate((node) => node === document.activeElement));
        i++
      )
        await page.keyboard.press("Tab");
      await expect(reload).toBeFocused();
      await Promise.all([page.waitForEvent("domcontentloaded"), page.keyboard.press("Enter")]);
      await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
      expect(imports).toBeGreaterThan(1);
      await expect(page.locator(".window-titlebar")).not.toHaveAttribute("data-persistent-test");
      expect(
        (await page.evaluate(() => window.uiStabilityFixture.utilityEvents)).map(
          (event) => event.kind,
        ),
      ).toEqual(["shell-ready"]);
      await expect(page.locator(".window-titlebar")).toHaveCount(1);
      await page.screenshot({ path: info.outputPath("05-reloaded-content.png") });
    } finally {
      release();
    }
  });
}

for (const mode of ["settings", "theme-manager"] as const)
  for (const failure of ["hang-once", "reject-once"] as const) {
    test(`${mode}/${failure}: preferences recover through a new store lifecycle`, async ({
      page,
    }, info) => {
      await canonicalPrepaint(page, "dark");
      await page.clock.install();
      await page.goto(
        `${fixture}?window=${mode}&windowInstance=9&settingsFailure=${failure}&settingsDelay=0`,
        { waitUntil: "commit" },
      );
      await expect
        .poll(() => page.evaluate(() => sessionStorage.getItem("utility-settings-reads")))
        .not.toBeNull();
      if (failure === "hang-once") await page.clock.fastForward(5_100);
      await expect(page.locator(".utility-window-ready .utility-load-status")).toBeVisible();
      await page.clock.fastForward(16_000);
      await expect(
        page.getByRole("alert").filter({ hasText: "could not be loaded" }),
      ).toBeVisible();
      const readsBefore = Number(
        await page.evaluate(() => sessionStorage.getItem("utility-settings-reads")),
      );
      expect(readsBefore).toBe(failure === "hang-once" ? 1 : 2);
      await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
      await expect(page.locator("main").getByRole("button")).toHaveCount(1);
      await expect(page.locator("main").getByRole("button")).toHaveText("Reload window");
      await expect(page.locator("main").getByRole("link")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("06-preferences-failed.png") });
      await page
        .locator("html")
        .evaluate((node) => node.setAttribute("data-document-test", "original"));
      await Promise.all([
        page.waitForEvent("domcontentloaded"),
        page.getByRole("button", { name: "Reload window", exact: true }).click(),
      ]);
      await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
      await expect(page.locator("html")).not.toHaveAttribute("data-document-test");
      expect(
        Number(await page.evaluate(() => sessionStorage.getItem("utility-settings-reads"))),
      ).toBe(readsBefore + 1);
      await expect
        .poll(() =>
          page.evaluate(() => window.uiStabilityFixture.utilityEvents.map((event) => event.kind)),
        )
        .toEqual(["shell-ready"]);
      await expect(page.locator(".reader-status-page")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath("07-new-document-preferences-ready.png") });
    });
  }
