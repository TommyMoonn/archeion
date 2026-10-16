import { expect, test } from "@playwright/test";

const kinds = {
  navigation: {
    module: "ReaderNavigationPanel",
    close: "Close book navigation",
    empty: "No book navigation",
  },
  search: { module: "ReaderSearchPanel", close: "Close Find in Book", empty: "Search this book" },
  annotations: {
    module: "ReaderAnnotationsPanel",
    close: "Close annotations",
    empty: "No annotations",
  },
} as const;

for (const [kind, details] of Object.entries(kinds)) {
  test(`${kind}: cold module and data resolve within the same header and drawer`, async ({
    page,
  }, testInfo) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/src/features/reader/${details.module}.tsx`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/tests/browser/fixtures/reader-drawers.html?pending");
    await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
    await page.evaluate(() => {
      document.documentElement.dataset.motion = "on";
    });
    const immediate = await page.evaluate((kind) => {
      window.readerDrawer.show(kind as "navigation" | "search" | "annotations");
      return {
        shell: Boolean(document.querySelector(".reader-side-drawer")),
        header: Boolean(document.querySelector(".reader-side-panel__header")),
        state: document.querySelector<HTMLElement>("[data-readiness]")?.dataset.readiness,
      };
    }, kind);
    expect(immediate).toEqual({ shell: true, header: true, state: "module-loading" });
    const panel = page.locator(".reader-side-panel");
    await expect(panel.locator("[data-readiness]")).toHaveAttribute(
      "data-readiness",
      "module-loading",
    );
    const skeleton = panel.locator(".reader-panel-loading span").first();
    await expect(skeleton).toBeVisible();
    expect(
      await skeleton.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page.locator(".reader-side-drawer")).toHaveAttribute("data-state", "open");
    const before = await page.evaluate((closeLabel) => {
      const header = document.querySelector(".reader-side-panel__header")!;
      const drawer = document.querySelector(".reader-side-drawer")!;
      const button = document.querySelector<HTMLButtonElement>(
        `button[aria-label="${closeLabel}"]`,
      )!;
      button.focus();
      Object.assign(window, { readinessNodes: { header, drawer, button } });
      return {
        header: header.getBoundingClientRect().toJSON(),
        panel: document.querySelector(".reader-side-panel")!.getBoundingClientRect().toJSON(),
        stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
        resizes: window.readerDrawer.resizeCalls(),
        cfi: window.readerInteractions.location(),
      };
    }, details.close);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-module-loading.png`) });
    release();
    await expect(panel.locator("[data-readiness]")).toHaveAttribute("data-readiness", "loading");
    await expect(panel.locator("[aria-busy=true]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: details.close, exact: true })).toBeFocused();
    await page.evaluate(() => window.readerDrawer.resolveData());
    await expect(panel.locator("[data-readiness]")).toHaveAttribute(
      "data-readiness",
      kind === "search" ? "idle" : "empty",
    );
    const after = await page.evaluate(() => {
      const saved = (
        window as unknown as {
          readinessNodes: { header: Element; drawer: Element; button: Element };
        }
      ).readinessNodes;
      return {
        sameHeader: saved.header === document.querySelector(".reader-side-panel__header"),
        sameDrawer: saved.drawer === document.querySelector(".reader-side-drawer"),
        sameFocus: saved.button === document.activeElement,
        animations: saved.drawer.getAnimations().length,
        header: saved.header.getBoundingClientRect().toJSON(),
        panel: document.querySelector(".reader-side-panel")!.getBoundingClientRect().toJSON(),
        stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
        resizes: window.readerDrawer.resizeCalls(),
        cfi: window.readerInteractions.location(),
      };
    });
    expect(after).toEqual({
      ...before,
      sameHeader: true,
      sameDrawer: true,
      sameFocus: true,
      animations: 0,
    });
    await testInfo.attach(`${kind}-readiness-geometry`, {
      body: JSON.stringify({ before, after }),
      contentType: "application/json",
    });
    await expect(panel).toContainText(details.empty);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-resolved.png`) });
    await page.getByRole("button", { name: details.close, exact: true }).click();
    await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
  });

  test(`${kind}: pending chunk cannot reopen a closed drawer or replace a new book header`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/src/features/reader/${details.module}.tsx`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/tests/browser/fixtures/reader-drawers.html?pending");
    await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
    await page.evaluate((kind) => window.readerDrawer.show(kind as "navigation"), kind);
    await expect(page.locator("[data-readiness]")).toHaveAttribute(
      "data-readiness",
      "module-loading",
    );
    await page.getByRole("button", { name: details.close, exact: true }).click();
    await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
    await page.evaluate(() => {
      window.readerDrawer.switchBook();
      window.readerDrawer.show("settings");
    });
    release();
    await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    await expect(page.locator(".reader-side-panel")).toHaveCount(1);
    await expect(page.locator(".reader-side-panel")).toHaveAttribute(
      "aria-label",
      "Reader settings",
    );
  });
}

test("module failure keeps a closeable frame and useful recovery", async ({ page }) => {
  await page.route("**/src/features/reader/ReaderNavigationPanel.tsx", (route) => route.abort());
  await page.goto("/tests/browser/fixtures/reader-drawers.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.getByRole("button", { name: "Navigation", exact: true }).click();
  await expect(page.locator("[data-readiness]")).toHaveAttribute("data-readiness", "error");
  await expect(page.getByRole("alert")).toContainText("Navigation could not be loaded");
  await expect(page.getByRole("button", { name: "Reload Reader", exact: true })).toBeEnabled();
  await page.unroute("**/src/features/reader/ReaderNavigationPanel.tsx");
  await page.getByRole("button", { name: "Reload Reader", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.getByRole("button", { name: "Navigation", exact: true }).click();
  await expect(page.locator("[data-readiness]")).toHaveAttribute("data-readiness", "empty");
  await page.getByRole("button", { name: "Close book navigation", exact: true }).click();
  await expect(page.locator(".reader-side-drawer")).toHaveCount(0);
});

test("prewarm imports are deferred until Reader readiness and share click-to-open code", async ({
  page,
}) => {
  const imports: string[] = [];
  page.on("request", (request) => {
    if (/\/Reader(Navigation|Search|Annotations)Panel\.tsx$/.test(request.url()))
      imports.push(request.url());
  });
  await page.goto("/tests/browser/fixtures/reader-drawers.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  expect(imports).toHaveLength(0);
  await page.evaluate(() => window.readerDrawer.prewarm());
  await expect.poll(() => imports.length).toBe(3);
  await page.getByRole("button", { name: "Navigation", exact: true }).click();
  await expect(page.locator("[data-readiness]")).toHaveAttribute("data-readiness", "empty");
  expect(imports).toHaveLength(3);
});
