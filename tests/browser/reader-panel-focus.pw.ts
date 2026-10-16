import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/reader-drawers.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
});

test("a cold panel owns focus immediately and Search receives it when ready", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/src/features/reader/ReaderSearchPanel.tsx", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  try {
    await expect(page.locator(".reader-side-panel")).toBeFocused();
  } finally {
    release();
  }
  await expect(
    page.getByRole("searchbox", { name: "Find text in book", exact: true }),
  ).toBeFocused();
});

test("a late module does not take focus from a newer toolbar action", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/src/features/reader/ReaderSearchPanel.tsx", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const appearance = page.getByRole("button", { name: "Appearance", exact: true });
  await appearance.focus();
  release();
  await expect(page.locator("[data-readiness]")).toHaveAttribute("data-readiness", "idle");
  await expect(appearance).toBeFocused();
});

test("Tab stays in the active drawer and close restores its current toolbar trigger", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const input = page.getByRole("searchbox", { name: "Find text in book", exact: true });
  const close = page.getByRole("button", { name: "Close Find in Book", exact: true });
  await expect(input).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
});

for (const mode of ["continuous", "paged"] as const) {
  for (const width of [1100, 390]) {
    test(`${mode} ${width}px: switching during entrance keeps one shell, width, location and latest focus`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(async (mode) => {
        await window.readerInteractions.open("long-spine", mode);
        await window.readerDrawer.warmPanels();
        document.documentElement.dataset.motion = "on";
      }, mode);
      await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.readerInteractions.location()))
        .not.toBeNull();
      const evidence = await page.evaluate(async () => {
        const stage = document.querySelector(".epub-container")!;
        const before = {
          stage: stage.getBoundingClientRect().toJSON(),
          cfi: window.readerInteractions.location(),
          resizes: window.readerDrawer.resizeCalls(),
        };
        window.readerDrawer.show("navigation");
        const drawer = document.querySelector(".reader-side-drawer")!;
        while (!drawer.getAnimations().length) await new Promise(requestAnimationFrame);
        const entry = drawer.getAnimations()[0];
        entry.pause();
        entry.currentTime = Number(entry.effect!.getTiming().duration) * 0.4;
        const samples = [];
        for (const kind of [
          "search",
          "settings",
          "annotations",
          "navigation",
          "search",
          "settings",
          "annotations",
        ] as const) {
          window.readerDrawer.show(kind);
          await new Promise(requestAnimationFrame);
          const panel = document.querySelector<HTMLElement>(".reader-side-panel")!;
          samples.push({
            sameShell: drawer === document.querySelector(".reader-side-drawer"),
            sameAnimation: entry === drawer.getAnimations()[0],
            time: entry.currentTime,
            width: drawer.getBoundingClientRect().width,
            stage: stage.getBoundingClientRect().toJSON(),
            cfi: window.readerInteractions.location(),
            resizes: window.readerDrawer.resizeCalls(),
            focusedPanel: panel.contains(document.activeElement),
            label: panel.getAttribute("aria-label"),
            pressed: [...document.querySelectorAll("nav button[aria-expanded=true]")].map(
              (button) => button.textContent,
            ),
          });
        }
        entry.play();
        return { before, samples };
      });
      const first = evidence.samples[0];
      for (const sample of evidence.samples) {
        expect(sample.sameShell).toBe(true);
        expect(sample.sameAnimation).toBe(true);
        expect(sample.time).toBe(first.time);
        expect(sample.width).toBe(first.width);
        expect(sample.stage).toEqual(evidence.before.stage);
        expect(sample.cfi).toBe(evidence.before.cfi);
        expect(sample.resizes).toBe(evidence.before.resizes);
        expect(sample.focusedPanel).toBe(true);
        expect(sample.pressed).toHaveLength(1);
      }
      expect(evidence.samples.at(-1)?.label).toBe("Annotations");
      expect(evidence.samples.at(-1)?.pressed).toEqual(["Annotations"]);
      await expect(page.locator(".reader-side-drawer")).toHaveAttribute("data-state", "open");
      await page.screenshot({ path: testInfo.outputPath("switched-drawer.png") });
      await testInfo.attach("switch-geometry", {
        body: JSON.stringify(evidence),
        contentType: "application/json",
      });
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByRole("searchbox", { name: "Find text in book" })).toBeFocused();
      await expect(page.locator(".reader-side-drawer")).toHaveAttribute("data-state", "open");
      expect(
        await page
          .locator(".reader-side-drawer")
          .evaluate((element) => element.getAnimations().length),
      ).toBe(0);
    });
  }
}

test("the open drawer blocks book focus, wheel, page keys and backdrop click-through", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Find text in book" })).toBeFocused();
  await expect(page.locator(".epub-viewer__stage")).toHaveAttribute("inert", "");
  const before = await page.evaluate(() => ({
    cfi: window.readerInteractions.location(),
    keys: window.readerInteractions.keys(),
    top: document.querySelector(".epub-container")!.scrollTop,
  }));
  await page.mouse.move(100, 300);
  await page.mouse.wheel(0, 500);
  await page.keyboard.press("PageDown");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Close Find in Book" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("searchbox", { name: "Find text in book" })).toBeFocused();
  await page.mouse.click(100, 300);
  await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
  await expect(page.locator(".epub-viewer__stage")).not.toHaveAttribute("inert");
  expect(
    await page.evaluate(() => ({
      cfi: window.readerInteractions.location(),
      keys: window.readerInteractions.keys(),
      top: document.querySelector(".epub-container")!.scrollTop,
    })),
  ).toEqual(before);
});

test("an export menu consumes one Escape or outside gesture before Annotations", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Annotations", exact: true }).click();
  const menu = page.locator(".reader-annotations__export-menu");
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.getByRole("combobox", { name: "Sort annotations" }).focus();
  await page.keyboard.press("Tab");
  await expect(menu.locator("summary")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open");
  await expect(menu.locator("summary")).toBeFocused();
  await expect(page.locator(".reader-side-panel")).toBeVisible();
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await page.mouse.click(100, 300);
  await expect(menu).not.toHaveAttribute("open");
  await expect(page.locator(".reader-side-panel")).toBeVisible();
  await page.mouse.click(100, 300);
  await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
});

for (const motion of ["on", "off", "reduced"] as const) {
  test(`${motion}: keyboard switching survives resize and teardown releases book interaction`, async ({
    page,
  }) => {
    if (motion === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate((motion) => {
      document.documentElement.dataset.motion = motion === "off" ? "off" : "on";
    }, motion);
    const search = page.getByRole("button", { name: "Search", exact: true });
    await search.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("searchbox", { name: "Find text in book" })).toBeFocused();
    const drawer = await page.locator(".reader-side-drawer").elementHandle();
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(page.locator(".reader-side-panel")).toHaveCSS("width", "372px");
    await page.getByRole("button", { name: "Appearance", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Close reader settings" })).toBeFocused();
    expect(
      await drawer!.evaluate(
        (element) => element === document.querySelector(".reader-side-drawer"),
      ),
    ).toBe(true);
    if (motion !== "on")
      expect(await drawer!.evaluate((element) => element.getAnimations().length)).toBe(0);
    await page.evaluate(() => window.readerDrawer.dispose());
    await expect(page.locator("[data-application-transient=reader-panel]")).toHaveCount(0);
    await expect(page.locator(".epub-viewer__stage")).not.toHaveAttribute("inert");
  });
}
