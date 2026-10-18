import { expect, test, type Page } from "@playwright/test";
import { startUIStabilityCapture } from "./ui-stability-capture";

const fixture = "/tests/browser/fixtures/ui-stability.html";
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.uiStabilityProbe?.stop()).catch(() => undefined);
});
async function ready(page: Page) {
  await expect(page.locator("[data-window-total]")).toBeVisible();
}
async function frames(page: Page, count = 15) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= count ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

test("real app synthetic route, archive, collection and modal baseline", async ({ page }, info) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const finish = await startUIStabilityCapture(page, info);
  await page.goto(`${fixture}?count=50`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await frames(page);
  await page.evaluate(() => window.uiStabilityProbe.mark("library-ready"));
  // Use production actions for route ownership, not a hand-written route stand-in.
  await page.locator(".book-card__select").first().click();
  await page.getByRole("button", { name: "Read book", exact: true }).click();
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await frames(page);
  await page.evaluate(() => window.uiStabilityProbe.mark("reader-ready"));
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await ready(page);
  await page.evaluate(() => window.uiStabilityProbe.mark("library-return"));
  await page.evaluate(() => window.uiStabilityFixture.switchArchive("b"));
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().archive)).toBe("b");
  await page.evaluate(() => window.uiStabilityFixture.resizeCatalog(0));
  await expect(page.locator("[data-surface-state=empty]")).toBeVisible();
  await frames(page);
  await page.evaluate(() => window.uiStabilityFixture.resizeCatalog(50));
  await ready(page);
  await page.locator(".book-card").first().click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  await frames(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await frames(page);
  const report = await finish({
    count: 50,
    cache: "fresh browser context; first route open then warm return",
    displayScale: "browser default, not native DPI",
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  expect(report.probe.frames.some((frame) => frame.state?.route === "reader")).toBe(true);
  expect(report.probe.frames.some((frame) => frame.groups.dialog!.mounted > 0)).toBe(true);
  expect(report.probe.events.some((event) => event.kind === "blob-create")).toBe(true);
  expect(report.probe.events.some((event) => event.kind === "dom-unmount")).toBe(true);
  expect(report.probe.dropped).toBe(0);
});

for (const count of [0, 2, 48, 49, 50, 500, 3000]) {
  test(`catalog baseline ${count} books`, async ({ page }, info) => {
    const finish = await startUIStabilityCapture(page, info);
    await page.goto(`${fixture}?count=${count}`, { waitUntil: "domcontentloaded" });
    if (count === 0) await expect(page.locator("[data-surface-state=empty]")).toBeVisible();
    else {
      await ready(page);
      await expect
        .poll(() =>
          page
            .locator(".book-cover img")
            .first()
            .evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBe(120);
      await expect(page.locator("[data-window-total]")).toHaveAttribute(
        "data-window-total",
        String(count),
      );
      if (count > 48)
        await expect(page.locator("[data-window-total]")).toHaveAttribute("data-windowed", "true");
      await page.locator(".page-shell").evaluate((node) => {
        node.scrollTop = node.scrollHeight / 2;
      });
      await frames(page);
      await page.locator(".page-shell").evaluate((node) => {
        node.scrollTop = 0;
      });
    }
    await frames(page);
    const report = await finish({ count, cache: "fresh context", displayScale: "browser default" });
    expect(report.probe.frames.length).toBeGreaterThan(10);
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

test("metadata pending changes, busy action and failed status geometry", async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const finish = await startUIStabilityCapture(page, info);
  await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.locator(".book-card__select").first().click();
  await page.getByRole("button", { name: "Edit metadata", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeVisible();
  await frames(page);
  await title.fill("Synthetic edited title");
  await frames(page);
  await page.getByRole("textbox", { name: "Author", exact: true }).fill("Synthetic author");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Synthetic description. ".repeat(150));
  await frames(page);
  await page.getByRole("button", { name: "Write metadata to EPUB", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Synthetic write failure");
  await frames(page);
  const report = await finish({
    count: 2,
    operation: "synthetic failed metadata write",
    cache: "first-open",
  });
  expect(report.probe.frames.some((frame) => frame.groups.footer!.mounted > 0)).toBe(true);
  expect(
    report.probe.frames.some((frame) =>
      frame.groups.actions!.bounds.some(
        (bounds) => bounds.disabled && bounds.labelLength === "Writing metadata".length,
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
});

test("toast states and list/grid reversal preserve measurable anchors", async ({ page }, info) => {
  const finish = await startUIStabilityCapture(page, info);
  await page.goto(`${fixture}?count=500`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.mouse.move(900, 600);
  await page.mouse.wheel(0, 600);
  await frames(page);
  for (const status of ["available", "downloading", "ready", "idle"] as const) {
    await page.evaluate(
      (status) =>
        window.uiStabilityFixture.setUpdate({
          status,
          available:
            status === "idle" ? null : { version: "1.8.0", notes: null, publishedAt: null },
        }),
      status,
    );
    await frames(page);
  }
  for (const view of ["list", "grid"] as const) {
    await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
    await expect(page.locator(`.book-${view}`)).toBeVisible();
    await frames(page);
  }
  const report = await finish({
    count: 500,
    cache: "same-document update presentation and view switches",
  });
  expect(report.probe.frames.some((frame) => frame.collection?.view === "list")).toBe(true);
  expect(report.probe.inputs.some((input) => input.kind === "wheel" && input.trusted)).toBe(true);
  expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
});

for (const theme of ["dark", "light", "system-light", "custom"]) {
  test(`first-paint palette and font/icon observation ${theme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: "light" });
    const finish = await startUIStabilityCapture(page, info);
    await page.goto(`${fixture}?count=2&theme=${theme}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await page.locator(".book-card__select").first().click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await frames(page);
    await page.keyboard.press("Escape");
    await page.locator(".book-card__select").first().click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await frames(page);
    const report = await finish({
      theme,
      count: 2,
      cache: "fresh context, first modal open and same-document reopen",
    });
    expect(report.probe.frames.some((frame) => frame.groups.icons!.mounted > 0)).toBe(true);
    expect(report.probe.frames.at(-1)!.fonts.status).toBe("loaded");
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

for (const reader of ["light", "dark", "sepia"]) {
  test(`Reader entry palette ${reader}`, async ({ page }, info) => {
    const finish = await startUIStabilityCapture(page, info);
    await page.goto(`${fixture}?count=2&reader=${reader}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.locator(".book-card__select").first().click();
    await page.getByRole("button", { name: "Read book", exact: true }).click();
    await expect(page.locator(".epub-container iframe").first()).toBeVisible();
    await frames(page);
    await finish({ reader, count: 2, cache: "fresh context; first Reader entry" });
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

for (const windowMode of ["about", "settings", "archive-manager", "theme-manager"]) {
  test(`auxiliary frontend entry ${windowMode}`, async ({ page }, info) => {
    const finish = await startUIStabilityCapture(page, info);
    await page.goto(`${fixture}?window=${windowMode}&theme=light`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(`.window-app--${windowMode}`)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await finish({
      windowMode,
      cache: "fresh context",
      nativeVisibility: "mocked shown before frontend; requires native observation",
    });
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

for (const mode of ["app-off", "system-reduce"]) {
  test(`narrow layout motion observation ${mode}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 560, height: 700 });
    await page.emulateMedia({
      reducedMotion: mode === "system-reduce" ? "reduce" : "no-preference",
    });
    const finish = await startUIStabilityCapture(page, info);
    await page.goto(`${fixture}?count=49&motion=${mode === "app-off" ? "off" : "on"}`, {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    await frames(page);
    const report = await finish({ mode, width: 560, cache: "fresh context" });
    expect(report.probe.frames.at(-1)!.motion.app).toBe("off");
  });
}

test("probe preserves privacy, bounds output, and stops without retaining DOM or URL wrappers", async ({
  page,
}) => {
  const { installUIStabilityProbe } = await import("./fixtures/ui-stability-probe");
  await page.setContent("<!doctype html><html><body></body></html>");
  const result = await page.evaluate(async (installSource) => {
    const original = URL.createObjectURL;
    const install = (0, eval)(`(${installSource})`) as typeof installUIStabilityProbe;
    install({ limit: 3 });
    const node = document.createElement("div");
    node.className = "book-card";
    node.dataset.readerBookId = "private-book";
    node.textContent = "PRIVATE EPUB CONTENT";
    document.body.append(node);
    const url = URL.createObjectURL(new Blob(["PRIVATE EPUB CONTENT"]));
    URL.revokeObjectURL(url);
    for (let i = 0; i < 8; i++) window.uiStabilityProbe.mark("bounded");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const first = window.uiStabilityProbe.stop();
    node.remove();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      first,
      second: window.uiStabilityProbe.stop(),
      restored: URL.createObjectURL === original,
    };
  }, installUIStabilityProbe.toString());
  expect(result.restored).toBe(true);
  expect(result.first).toEqual(result.second);
  expect(result.first.events.length).toBeLessThanOrEqual(3);
  expect(result.first.dropped).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private-book|blob:http|file:\/\//);
});

for (const hypothesis of ["font", "lazy-mount"]) {
  test(`UX-15 isolated delayed ${hypothesis} observation`, async ({ page }, info) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const pattern = hypothesis === "font" ? "**/Inter-*.woff2" : "**/BookDetailsDrawer.tsx*";
    await page.route(pattern, async (route) => {
      requests++;
      await held;
      await route.continue();
    });
    const finish = await startUIStabilityCapture(page, info);
    let report;
    try {
      await page.goto(`${fixture}?count=2&motion=off`, { waitUntil: "domcontentloaded" });
      await ready(page);
      if (hypothesis === "lazy-mount") await page.locator(".book-card__select").first().click();
      await expect.poll(() => requests).toBeGreaterThan(0);
      await page.evaluate(() => window.uiStabilityProbe.mark("dependency-held"));
      await frames(page, 20);
      if (hypothesis === "lazy-mount") await expect(page.locator(".details-drawer")).toHaveCount(0);
      release();
      if (hypothesis === "font") await page.evaluate(() => document.fonts.ready);
      else await expect(page.locator(".details-drawer[open]")).toBeVisible();
      await page.evaluate(() => window.uiStabilityProbe.mark("dependency-released"));
      await frames(page);
    } finally {
      release();
      report = await finish({
        hypothesis,
        artificialDelay: "20 animation frames after intercepted request",
        cache: "fresh context with interception; causal experiment, not natural reproduction",
      });
    }
    if (hypothesis === "font") {
      expect(report.probe.frames.some((frame) => frame.fonts.status === "loading")).toBe(true);
      expect(report.probe.frames.at(-1)!.fonts.status).toBe("loaded");
    } else expect(report.probe.frames.some((frame) => frame.groups.dialog!.mounted > 0)).toBe(true);
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}
