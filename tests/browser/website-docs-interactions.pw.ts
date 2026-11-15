import { expect, test } from "@playwright/test";

const guide = "/archeion/docs/customization/custom-themes/";

test("theme migration precedes hydration, toggles persist, and storage failures are nonfatal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("theme-seeded")) {
      localStorage.setItem("archeion-docs-theme", "light");
      sessionStorage.setItem("theme-seeded", "yes");
    }
  });
  await page.goto(guide);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const toggle = page.getByRole("button", { name: "Switch to dark theme" });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Search documentation", exact: true })).toHaveCSS(
    "background-color",
    "rgb(26, 26, 27)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("archeion-docs-theme"))).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b0b0c");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("storage blocked");
    };
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("production first paint uses migrated preference without the React bundle", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.ARCHEION_WEBSITE_MODE === "dev",
    "Production HTML owns pre-hydration initialization",
  );
  for (const [old, current, expected] of [
    ["light", null, "light"],
    ["system", null, "dark"],
    ["invalid", null, "dark"],
    ["light", "dark", "dark"],
  ]) {
    const context = await browser.newContext();
    try {
      await context.addInitScript(
        ({ old, current }) => {
          localStorage.setItem("archeion-docs-theme", old ?? "");
          if (current) localStorage.setItem("theme", current);
        },
        { old, current },
      );
      await context.route("**/*.js", (route) => route.abort());
      const page = await context.newPage();
      await page.goto(`${baseURL}${guide}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", expected ?? "dark");
      await expect(page.getByRole("main")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(
        page.locator("main").locator("xpath=ancestor::div[contains(@class,'min-h-screen')]"),
      ).toHaveCSS(
        "background-color",
        expected === "light" ? "rgb(247, 248, 247)" : "rgb(11, 11, 12)",
      );
    } finally {
      await context.close();
    }
  }
});

test("drawer traps focus, blocks background, dismisses safely and releases scroll lock", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(guide);
  const opener = page.getByRole("button", { name: "Open documentation navigation" });
  const drawer = page.getByRole("dialog", { name: "Documentation menu" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(drawer.locator("section")).toHaveCSS("translate", "none");
  expect(await drawer.evaluate((node) => getComputedStyle(node, "::backdrop").top)).toBe("68px");
  expect(
    await drawer.evaluate((node) => getComputedStyle(node, "::backdrop").backgroundColor),
  ).toBe("rgba(0, 0, 0, 0.45)");
  await page.screenshot({ path: testInfo.outputPath("drawer-800.png") });
  await expect(page.locator("html")).toHaveCSS("overflow-y", "hidden");
  await page
    .getByRole("button", { name: "Search documentation", exact: true })
    .evaluate((node: HTMLButtonElement) => node.focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("html")).not.toHaveCSS("overflow-y", "hidden");
  await opener.click();
  await page.mouse.click(780, 300);
  await expect(drawer).toBeHidden();
  await opener.click();
  await close.click();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.setViewportSize({ width: 801, height: 700 });
  await expect(drawer).toBeHidden();
  await expect(
    page
      .getByRole("complementary", { name: "Documentation navigation" })
      .getByRole("link", { name: "Custom themes", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 800, height: 700 });
  await opener.click();
  await drawer.getByRole("link", { name: "Custom themes", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("main")).toBeFocused();
  await opener.click();
  await drawer.getByRole("link", { name: "Theme Manager", exact: true }).click();
  await expect(page).toHaveURL(/theme-manager\/$/);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.locator("html")).not.toHaveCSS("overflow-y", "hidden");
});

test("modified drawer links preserve native behavior and modal ownership stays exclusive", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(guide);
  await page.getByRole("button", { name: "Open documentation navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Documentation menu" });
  const newPage = context.waitForEvent("page");
  await drawer
    .getByRole("link", { name: "Theme Manager", exact: true })
    .click({ modifiers: ["Control"] });
  const tab = await newPage;
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/theme-manager\/$/);
  await tab.close();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search documentation" })).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Search documentation" })).toBeVisible();
  await expect(drawer).toBeHidden();
  await page.keyboard.press("Escape");
});

test("sidebar collapse persists while the current group reopens on navigation and reload", async ({
  page,
}) => {
  await page.goto("/archeion/docs/guides/keyboard-shortcuts/");
  const sidebar = page.getByRole("complementary", { name: "Documentation navigation" });
  const reference = sidebar
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Customization" }) });
  await reference.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(reference).not.toHaveAttribute("open", "");
  await page.reload();
  await expect(reference).not.toHaveAttribute("open", "");
  await page
    .getByRole("navigation", { name: "Documentation pages" })
    .getByRole("link", { name: "Next Appearance" })
    .click();
  await expect(reference).toHaveAttribute("open", "");
  await reference.locator("summary").click();
  await page.reload();
  await expect(reference).toHaveAttribute("open", "");
});

test("outline follows fragments, reverse scrolling, reflow and the final short section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(guide);
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  const active = toc.locator('[aria-current="location"]');
  await expect(active).toHaveText("Create a theme package");
  await toc.getByRole("link", { name: "Folder structure", exact: true }).click();
  await expect(page).toHaveURL(/#package-layout$/);
  await expect(active).toHaveText("Folder structure");
  await expect(page.locator("#package-layout")).toBeFocused();
  await page.reload();
  await expect(active).toHaveText("Folder structure");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(active).toHaveText("Examples");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(active).toHaveText("Create a theme package");
  await page.locator("article").evaluate((node) => {
    node.style.fontSize = "24px";
  });
  await toc.getByRole("link", { name: "Theme file fields", exact: true }).click();
  await expect(active).toHaveText("Theme file fields");
  await expect(active).toHaveCount(1);
  const permalink = page.locator("#theme-fields").getByRole("link");
  await permalink.focus();
  await expect(permalink).toHaveCSS("opacity", "1");
  await expect(permalink).toHaveAttribute("href", "#theme-fields");
});

test("code copy preserves exact text, stable labels, focus and persistent failure recovery", async ({
  page,
}, testInfo) => {
  await page.goto(guide);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    });
  });
  const copy = page.getByRole("button", { name: "Copy code", exact: true }).first();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Code copied.");
  await expect(copy).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("code-copy-feedback.png") });
  expect(await page.evaluate(() => document.documentElement.dataset.copied)).toBe(
    await page.locator("pre code").first().textContent(),
  );
  await page.getByRole("button", { name: "Dismiss copy status" }).click();
  await expect(copy).toBeFocused();
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("denied");
    };
  });
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Could not copy code. Try Copy code again.");
  await expect(copy).toHaveAccessibleName("Copy code");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {};
  });
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Code copied.");
  await page
    .getByRole("navigation", { name: "Documentation pages" })
    .getByRole("link", { name: "Next Theme Manager" })
    .click();
  await expect(page.getByRole("status")).toBeEmpty();
});

test("a clipboard completion after leaving the article cannot publish stale feedback", async ({
  page,
}) => {
  await page.goto(guide);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            document.addEventListener("finish-copy", () => resolve(), { once: true });
          }),
      },
    });
  });
  await page.getByRole("button", { name: "Copy code" }).first().click();
  await expect(page.getByRole("status")).toHaveText("Copying code…");
  await page
    .getByRole("navigation", { name: "Documentation pages" })
    .getByRole("link", { name: "Next Theme Manager" })
    .click();
  await page.evaluate(() => document.dispatchEvent(new Event("finish-copy")));
  await expect(page.getByRole("status")).toBeEmpty();
});

test("newer clipboard requests retain ownership when an older request fails", async ({ page }) => {
  await page.goto(guide);
  await page.evaluate(() => {
    let request = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          ++request === 1
            ? new Promise<void>((_resolve, reject) => {
                document.addEventListener("fail-old-copy", () => reject(new Error("old failure")), {
                  once: true,
                });
              })
            : Promise.resolve(),
      },
    });
  });
  const copy = page.getByRole("button", { name: "Copy code" }).first();
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Copying code…");
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("Code copied.");
  await page.evaluate(() => document.dispatchEvent(new Event("fail-old-copy")));
  await expect(page.getByRole("status")).toHaveText("Code copied.");
});

test("coarse pointer controls remain visible and usable in reduced motion and forced colors", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 480 },
    reducedMotion: "reduce",
    forcedColors: "active",
  });
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}${guide}`);
    const copy = page.getByRole("button", { name: "Copy code" }).first();
    await expect(copy).toHaveCSS("opacity", "1");
    await expect(copy).toHaveCSS("min-width", "44px");
    await copy.focus();
    await expect(copy).toHaveCSS("outline-style", "solid");
    const opener = page.getByRole("button", { name: "Open documentation navigation" });
    await expect(opener).toHaveCSS("min-width", "44px");
    await opener.tap();
    const drawer = page.getByRole("dialog", { name: "Documentation menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("section")).toHaveCSS("width", "268px");
    await expect(drawer.locator("section")).toHaveCSS("transition-duration", "0s");
    await drawer.getByRole("link", { name: "Theme Manager", exact: true }).tap();
    await expect(page).toHaveURL(/theme-manager\/$/);
    await expect(drawer).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
