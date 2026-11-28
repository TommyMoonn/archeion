import { expect, test, type Locator, type Page } from "@playwright/test";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { applicationPresentation } from "../../src/themes/appearancePresentation";
import { builtInShellPalettes as shellPalettes } from "../../src/themes/builtInThemes";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

const fixture = "/tests/browser/fixtures/ui-stability.html";

const windows = [
  {
    mode: "about",
    module: "AboutWindow",
    slot: "identity",
    plane: "#about-main-content",
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
    plane: 'section[aria-label="Theme Manager"]',
    width: 1100,
    height: 780,
  },
  {
    mode: "archive-manager",
    module: "ArchiveManagerWindow",
    slot: null,
    plane: "[data-archive-detail]",
    width: 1100,
    height: 760,
  },
] as const;

// Match development modules and hashed production chunks so the same recovery
// scenarios can run against either fixture build.
function featureImport(module: string) {
  return new RegExp(`/${module}(?:\\.tsx(?:\\?.*)?|-[^/]+\\.js)$`);
}

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
    const resolvedColor = (token: string) => {
      const node = document.createElement("span");
      node.style.color = `var(${token})`;
      document.body.append(node);
      const color = getComputedStyle(node).color;
      node.remove();
      return color;
    };
    return {
      titlebar: {
        ...rect(document.querySelector(".window-titlebar")!),
        color: getComputedStyle(document.querySelector(".window-titlebar")!).backgroundColor,
        border: getComputedStyle(document.querySelector(".window-titlebar")!).borderBottomColor,
        borderWidth: getComputedStyle(document.querySelector(".window-titlebar")!)
          .borderBottomWidth,
      },
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
        lineSubtle: resolvedColor("--line-subtle"),
      },
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
    };
  }, plane);
}

type Geometry = Awaited<ReturnType<typeof geometry>>;
type Rect = Geometry["main"];

function expectStableRect(actual: Rect, expected: Rect) {
  // Subpixel rounding can vary without causing a visible layout shift.
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), key).toBeLessThanOrEqual(1);
  }
}

function expectStableFrame(actual: Geometry, expected: Geometry) {
  expectStableRect(actual.titlebar, expected.titlebar);
  expectStableRect(actual.main, expected.main);
  expectStableRect(actual.plane, expected.plane);
  expect(actual.titlebar.color).toBe(expected.titlebar.color);
  expect(actual.titlebar.border).toBe(expected.titlebar.border);
  expect(actual.titlebar.borderWidth).toBe(expected.titlebar.borderWidth);
  expect(actual.plane.color).toBe(expected.plane.color);
  expect(actual.documentHeight).toBe(actual.viewportHeight);
}

async function expectCentered(indicator: Locator, content: Locator) {
  const [spinner, area] = await Promise.all([indicator.boundingBox(), content.boundingBox()]);
  if (!spinner || !area) throw new Error("Loading indicator or its content area is missing");
  expect(Math.abs(spinner.x + spinner.width / 2 - area.x - area.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(spinner.y + spinner.height / 2 - area.y - area.height / 2)).toBeLessThanOrEqual(
    1,
  );
}

for (const utility of windows)
  for (const theme of utility.mode === "archive-manager"
    ? (["dark", "light", "custom"] as const)
    : (["custom"] as const)) {
    test(`${utility.mode}/${theme}: destination geometry and planes survive import and hydration`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: utility.width, height: utility.height });
      await canonicalPrepaint(page, theme);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(featureImport(utility.module), async (route) => {
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
        const events = await page.evaluate(() => window.uiStabilityFixture.utilityEvents);
        expect(events.map((event) => event.kind)).toEqual(["shell-ready", "native-show"]);
        expect(events.every((event) => event.shell)).toBe(true);
        await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
        await expect(page.locator(".reader-status-page")).toHaveCount(0);
        const spinner = page.locator('.utility-load-status [data-slot="spinner"]');
        await expect(spinner).toBeVisible();
        await expect(spinner).toHaveAccessibleName(/^Loading /);
        const loadingArea = page.locator(
          utility.mode === "about"
            ? '.utility-load-status[data-utility-stage="loading"]'
            : utility.mode === "settings"
              ? '[data-utility-slot="content"]'
              : utility.mode === "theme-manager"
                ? '[data-utility-slot="details"]'
                : utility.plane,
        );
        await expectCentered(spinner, loadingArea);
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
        expect(before.titlebar.color).toBe(before.tokens.canvasDeep);
        expect(before.titlebar.border).toBe(before.tokens.lineSubtle);
        expect(before.titlebar.borderWidth).toBe("1px");
        expect(before.plane.color).toBe(
          utility.mode === "about" || utility.mode === "archive-manager"
            ? before.tokens.main
            : before.tokens.canvas,
        );
        // The custom palette intentionally has distinct planes. Do not flatten them.
        if (theme === "custom") expect(before.tokens.main).not.toBe(before.tokens.canvasDeep);
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator("main")).toBeFocused();
        if (utility.mode === "settings" || utility.mode === "theme-manager")
          await page.evaluate(() => window.uiStabilityFixture.holdUtilityInitialization());
        release();
        if (utility.mode === "settings" || utility.mode === "theme-manager") {
          await expect(page.locator("[data-utility-content]").locator(spinner)).toBeVisible();
          await expectCentered(spinner, loadingArea);
          await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
          const during = await geometry(page, utility.plane);
          expectStableFrame(during, before);
          for (const slot of Object.keys(before.slots))
            expectStableRect(during.slots[slot], before.slots[slot]);
          await page.evaluate(() => window.uiStabilityFixture.releaseUtilityInitialization());
        }
        await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
        await expect(page.locator(".utility-load-status")).toHaveCount(0);
        for (const selector of selectors)
          await expect(page.locator(selector)).toHaveAttribute("data-persistent-test", "original");
        const after = await geometry(page, utility.plane);
        expectStableFrame(after, before);
        if (utility.mode === "settings")
          expectStableRect(after.slots.content, before.slots.content);
        if (utility.mode === "theme-manager")
          expectStableRect(after.slots.workspace, before.slots.workspace);
        if (utility.mode === "about") expectStableRect(after.slots.identity, before.slots.identity);
        await expect(page.locator(".window-titlebar")).toHaveCount(1);
        await expect(page.locator(".reader-status-page")).toHaveCount(0);
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

test("Archive Manager centers the archive list spinner while the registry loads", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(`${fixture}?window=archive-manager&archiveRegistryDelay=10000`);
  const list = page.getByRole("complementary", { name: "Archives" });
  const spinner = list.getByRole("status", { name: "Loading archives" });
  await expect(spinner).toBeVisible();
  await expectCentered(spinner, list);
  await page.clock.fastForward(10_000);
  await expect(spinner).toHaveCount(0);
  await expect(list.getByRole("button", { name: /Synthetic a/ }).first()).toBeVisible();
});

for (const utility of windows) {
  test(`${utility.mode}: rejected import preserves the destination frame and reloads`, async ({
    page,
  }) => {
    await canonicalPrepaint(page, "light");
    await page.setViewportSize({ width: utility.width, height: utility.height });
    let imports = 0;
    await page.route(featureImport(utility.module), async (route) => {
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
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      page.getByRole("button", { name: "Reload window", exact: true }).click(),
    ]);
    await expect(page.locator("[data-utility-ready=true]")).toHaveCount(1);
    const after = await geometry(page, utility.plane);
    expectStableFrame(after, before);
    await expect(page.locator(".window-titlebar")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.uiStabilityFixture.utilityEvents.map((event) => event.kind)),
      )
      .toEqual(["shell-ready"]);
  });

  test(`${utility.mode}: indefinitely pending import recovers by a new document`, async ({
    page,
  }) => {
    await canonicalPrepaint(page, "dark");
    await page.setViewportSize({ width: utility.width, height: utility.height });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let imports = 0;
    await page.route(featureImport(utility.module), async (route) => {
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
      await expect(page.locator(".utility-load-status")).toBeVisible();
      await page.clock.fastForward(10_100);
      await expect(page.getByRole("alert")).toContainText("could not be loaded");
      await expect(page.locator(".window-titlebar")).toHaveAttribute(
        "data-persistent-test",
        "original",
      );
      const failed = await geometry(page, utility.plane);
      expectStableFrame(failed, before);
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
    } finally {
      release();
    }
  });
}

for (const mode of ["settings", "theme-manager"] as const)
  for (const failure of ["hang-once", "reject-once"] as const) {
    test(`${mode}/${failure}: preferences recover through a new store lifecycle`, async ({
      page,
    }) => {
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
      await expect(page.locator("[data-utility-content] [data-utility-stage]")).toBeVisible();
      await page.clock.fastForward(16_000);
      await expect(
        page.getByRole("alert").filter({ hasText: "could not be loaded" }),
      ).toBeVisible();
      const readsBefore = Number(
        await page.evaluate(() => sessionStorage.getItem("utility-settings-reads")),
      );
      expect(readsBefore).toBe(failure === "hang-once" ? 1 : 2);
      await expect(page.locator("[data-utility-ready]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reload window", exact: true })).toBeVisible();
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
    });
  }
