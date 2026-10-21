import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { themeColorContrastRatio } from "../../src/themes/themeColor";

const fixture = "/tests/browser/fixtures/ui-stability.html";
test.setTimeout(60000);
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function library(page: Page) {
  await expect(page.locator("[data-window-total]")).toBeVisible();
}

async function openBook(page: Page) {
  await page.locator(".book-card__select").first().click();
  await page.getByRole("button", { name: "Read book", exact: true }).click();
}

async function observeFrames(page: Page) {
  await page.evaluate(() => {
    const readState = window.uiStabilityState;
    if (!readState) throw new Error("Committed-route fixture probe is unavailable");
    const destinations: Array<{ committed: string; library: boolean }> = [];
    const frames: Array<{
      bg: string;
      stage: number[];
      statuses: number;
      retired: boolean;
      empty: boolean;
      lifecycle: string;
      rendition: boolean;
      iframeCount: number;
      closedHeading: boolean;
      errorClaim: boolean;
      genericHeader: boolean;
      recoveryButtons: number;
      titlebar: number[];
      toolbar: "book" | "exit" | "none";
      content: string;
      committed: "reader" | "library" | "other";
    }> = [];
    const sample = () => {
      const shell = document.querySelector<HTMLElement>(".reader-page");
      const stage = shell?.querySelector<HTMLElement>(".reader-content-stage");
      const committedRoute = readState().route;
      if (shell && stage) {
        const rect = stage.getBoundingClientRect();
        const titlebar = document.querySelector(".window-titlebar")?.getBoundingClientRect();
        const iframe = stage.querySelector("iframe");
        const rendition = Boolean(iframe && iframe.getBoundingClientRect().height > 0);
        const retired = shell.hasAttribute("data-reader-retiring");
        const content = shell.querySelector(".reader-exit")
          ? "exit"
          : rendition
            ? "rendition"
            : stage.querySelector(".reader-loading")
              ? "opening"
              : stage.querySelector('[role="alert"]')
                ? "error"
                : "empty";
        frames.push({
          bg: getComputedStyle(shell).backgroundColor,
          stage: [rect.x, rect.y, rect.width, rect.height],
          statuses: stage.querySelectorAll('[role="status"]').length,
          retired: shell.hasAttribute("data-reader-retiring"),
          empty: content === "empty",
          lifecycle:
            shell.dataset.readerPhase ?? (retired ? "closing" : rendition ? "ready" : "opening"),
          rendition,
          iframeCount: stage.querySelectorAll("iframe").length,
          closedHeading: shell.querySelector("h1")?.textContent === "Reader closed",
          errorClaim: Boolean(shell.querySelector(".reader-exit [role=alert]")),
          genericHeader:
            shell.querySelector(".reader-exit__header")?.textContent?.trim() === "Reader",
          recoveryButtons: shell.querySelectorAll(".reader-exit button").length,
          titlebar: titlebar ? [titlebar.x, titlebar.y, titlebar.width, titlebar.height] : [],
          toolbar: shell.querySelector(".reader-toolbar")
            ? "book"
            : shell.querySelector(".reader-exit__header")
              ? "exit"
              : "none",
          content,
          committed:
            committedRoute === "reader"
              ? "reader"
              : committedRoute === "library"
                ? "library"
                : "other",
        });
      } else if (destinations.length < 60) {
        destinations.push({
          committed: committedRoute === "library" ? "library" : "other",
          library: Boolean(document.querySelector("[data-window-total]")),
        });
      }
      if (frames.length < 1000) requestAnimationFrame(sample);
    };
    Object.assign(window, { handoffFrames: frames, handoffDestinations: destinations });
    // Acquire the first observable frame before a fast history Back can retire the Reader.
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        sample();
        resolve();
      }),
    );
  });
}

test("quiet successful acknowledged exit has no interim recovery page", async ({ page }, info) => {
  await page.goto(`${fixture}?count=2&reader=light`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".reader-page")).toHaveAttribute("data-reader-phase", "ready");
  await page.evaluate(async () => {
    await window.uiStabilityFixture.holdReaderExit();
    window.uiStabilityFixture.acknowledgeNextExit();
  });
  await observeFrames(page);
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().saveStarted))
    .toBe(true);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitSave());
  await expect(page.locator(".reader-exit")).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: info.outputPath("acknowledged-exit.png") });
  await writeFile(
    info.outputPath("acknowledged-exit-frames.json"),
    JSON.stringify(
      await page.evaluate(() => (window as unknown as { handoffFrames: unknown[] }).handoffFrames),
    ),
  );
  await expect(
    page.locator(".reader-exit [role=alert]"),
    "A successful acknowledgement is not a failed destination",
  ).toHaveCount(0);
  await expect(page.locator(".reader-exit h1, .reader-exit button")).toHaveCount(0);
  await expect(page.locator(".reader-exit__header")).toHaveCount(0);
  await page.evaluate(() => window.uiStabilityFixture.commitAcknowledgedExit());
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().destinationStarted))
    .toBe(true);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
  await library(page);
});

test("explicitly rejected exit has one actionable recovery", async ({ page }, info) => {
  await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".reader-page")).toHaveAttribute("data-reader-phase", "ready");
  await page.evaluate(() => window.uiStabilityFixture.rejectNextExit());
  await observeFrames(page);
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect(page.locator(".reader-exit [role=alert]")).toBeVisible();
  await expect(page.locator(".reader-exit button")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("rejected-exit.png") });
  await writeFile(
    info.outputPath("rejected-exit-frames.json"),
    JSON.stringify(
      await page.evaluate(() => (window as unknown as { handoffFrames: unknown[] }).handoffFrames),
    ),
  );
  await page.locator(".reader-exit button").focus();
  await page.keyboard.press("Enter");
  await library(page);
});

test("committed router error preserves hidden Reader geometry and offers one reload recovery", async ({
  page,
}, info) => {
  await page.goto(`${fixture}?count=2&reader=sepia`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".reader-page")).toHaveAttribute("data-reader-phase", "ready");
  await page.getByRole("button", { name: "Hide Reader toolbar", exact: true }).click();
  await expect(page.locator(".reader-page")).not.toHaveAttribute("data-toolbar-expanded");
  const bounds = await page.locator(".reader-content-stage").boundingBox();
  const color = await page
    .locator(".reader-page")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.evaluate(() => window.uiStabilityFixture.failNextLibraryLoader());
  await page.goBack();
  await expect(page.locator(".reader-exit [role=alert]")).toBeVisible();
  expect(await page.locator(".reader-content-stage").boundingBox()).toEqual(bounds);
  expect(
    await page.locator(".reader-page").evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe(color);
  await expect(page.locator(".reader-exit button")).toHaveCount(1);
  await expect(page.locator(".reader-exit button")).toBeFocused();
  await expect(page.locator("iframe, .reader-toolbar")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("committed-route-error.png") });
  // Reload the synthetic entry rather than the uninstrumented production index.
  await page.evaluate(
    (url) => history.replaceState(history.state, "", url),
    `${fixture}?count=2&reader=sepia`,
  );
  await page.keyboard.press("Enter");
  await library(page);
});

for (const theme of ["light", "dark", "sepia"]) {
  for (const motion of ["on", "app-off", "system-reduced"]) {
    test(`exit keeps a coherent whole Reader while progress save and Library commit are independently held: ${theme}/${motion}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({
        reducedMotion: motion === "system-reduced" ? "reduce" : "no-preference",
      });
      await page.goto(
        `${fixture}?count=2&reader=${theme}&motion=${motion === "app-off" ? "off" : "on"}`,
        { waitUntil: "domcontentloaded" },
      );
      await library(page);
      await openBook(page);
      await expect(page.locator(".epub-container iframe").first()).toBeVisible();
      await expect(page.locator(".reader-loading")).toHaveCount(0);
      const bounds = await page.locator(".reader-content-stage").boundingBox();
      const color = await page
        .locator(".reader-page")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      await page.evaluate(() => window.uiStabilityFixture.holdReaderExit());
      await observeFrames(page);
      if (motion === "system-reduced") await page.goBack();
      else
        await page
          .getByRole("button", { name: /Back to Library/ })
          .evaluate((button: HTMLButtonElement) => {
            button.click();
            button.click();
          });
      await expect
        .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().saveStarted))
        .toBe(true);
      await expect(page.locator(".epub-container iframe").first()).toBeVisible();
      expect(
        await page.evaluate(() => window.uiStabilityFixture.exitControl().destinationStarted),
      ).toBe(false);
      await page.evaluate(() => window.uiStabilityFixture.releaseExitSave());
      await expect
        .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().destinationStarted))
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            let count = 0;
            const sample = () => (++count === 8 ? resolve() : requestAnimationFrame(sample));
            requestAnimationFrame(sample);
          }),
      );
      const frames = await page.evaluate(
        () =>
          (
            window as unknown as {
              handoffFrames: Array<{
                retired: boolean;
                rendition: boolean;
                toolbar: string;
                content: string;
                bg: string;
                stage: number[];
                closedHeading: boolean;
                errorClaim: boolean;
                genericHeader: boolean;
                recoveryButtons: number;
                titlebar: number[];
              }>;
            }
          ).handoffFrames,
      );
      await writeFile(info.outputPath("controlled-exit-frames.json"), JSON.stringify(frames));
      await page.screenshot({ path: info.outputPath("held-reader-exit.png") });
      expect(frames.some((frame) => !frame.retired && frame.rendition)).toBe(true);
      expect(frames.some((frame) => frame.retired)).toBe(true);
      expect(
        frames.filter((frame) => frame.retired && frame.toolbar === "book" && !frame.rendition),
        "A retired Reader must not retain its obsolete book toolbar above an emptied stage",
      ).toEqual([]);
      expect(
        frames.every(
          (frame) =>
            !frame.retired ||
            (frame.content === "exit" && frame.toolbar !== "book" && !frame.rendition),
        ),
      ).toBe(true);
      expect(
        frames
          .filter((frame) => frame.retired)
          .every(
            (frame) =>
              !frame.closedHeading &&
              !frame.errorClaim &&
              !frame.genericHeader &&
              frame.recoveryButtons === 0,
          ),
      ).toBe(true);
      expect(new Set(frames.map((frame) => frame.titlebar.join(","))).size).toBe(1);
      expect(
        frames.every(
          (frame) => frame.bg === color && frame.stage.join(",") === frames[0].stage.join(","),
        ),
      ).toBe(true);
      await expect(page.locator(".reader-exit")).toBeVisible();
      await expect(
        page.locator(".reader-toolbar, .epub-container, .reader-side-surface"),
      ).toHaveCount(0);
      await expect(
        page.locator(".reader-exit button, .reader-exit h1, .reader-exit [role=alert]"),
      ).toHaveCount(0);
      await expect(page.locator(".reader-exit [role=status]")).toHaveText("Returning to Library…");
      expect(await page.locator(".reader-content-stage").boundingBox()).toEqual(bounds);
      expect(
        await page
          .locator(".reader-page")
          .evaluate((node) => getComputedStyle(node).backgroundColor),
      ).toBe(color);
      expect(
        await page.evaluate(() => window.uiStabilityFixture.exitControl().destinationCalls),
      ).toBe(1);
      await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
      await library(page);
      if (motion !== "system-reduced")
        await expect(page.locator(".book-card__select").first()).toBeFocused();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await writeFile(
        info.outputPath("committed-destination.json"),
        JSON.stringify(
          await page.evaluate(
            () => (window as unknown as { handoffDestinations: unknown[] }).handoffDestinations,
          ),
        ),
      );
    });
  }
}

test("hidden toolbar retains its zero-clearance stage through keyboard history exit", async ({
  page,
}) => {
  await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await expect(page.locator(".reader-page")).toHaveAttribute("data-reader-phase", "ready");
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Hide Reader toolbar", exact: true }).click();
  await expect(page.locator(".reader-page")).not.toHaveAttribute("data-toolbar-expanded");
  const bounds = await page.locator(".reader-content-stage").boundingBox();
  await page.evaluate(() => window.uiStabilityFixture.holdReaderExit());
  await page.goBack();
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().saveStarted))
    .toBe(true);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitSave());
  await expect(page.locator(".reader-exit")).toBeVisible();
  expect(await page.locator(".reader-content-stage").boundingBox()).toEqual(bounds);
  await expect(page.locator(".reader-exit__clearance")).toBeHidden();
  await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
  await library(page);
});

test("delayed save failure keeps the usable rendition and permits retry", async ({
  page,
}, info) => {
  await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await page.evaluate(() => window.uiStabilityFixture.holdReaderExit());
  await observeFrames(page);
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().saveStarted))
    .toBe(true);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitSave(true));
  await expect(page.locator(".reader-toolbar [data-error]")).toBeVisible();
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await expect(page.locator(".reader-exit")).toHaveCount(0);
  expect(await page.evaluate(() => window.uiStabilityFixture.exitControl().destinationCalls)).toBe(
    0,
  );
  await page.evaluate(() => window.uiStabilityFixture.releaseExitSave(false));
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect(page.locator(".reader-exit")).toBeVisible();
  await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
  await library(page);
  await writeFile(
    info.outputPath("save-failure-frames.json"),
    JSON.stringify(
      await page.evaluate(() => (window as unknown as { handoffFrames: unknown[] }).handoffFrames),
    ),
  );
});

for (const interruption of ["rejection", "supersession", "archive"]) {
  test(`retired Reader recovers without stale controls after ${interruption}`, async ({
    page,
  }, info) => {
    await page.goto(`${fixture}?count=2&archiveDelay=300&scanDelay=300`, {
      waitUntil: "domcontentloaded",
    });
    await library(page);
    await openBook(page);
    await expect(page.locator(".reader-loading")).toHaveCount(0);
    if (interruption === "supersession") await page.clock.install();
    await page.evaluate(() => window.uiStabilityFixture.holdReaderExit());
    if (interruption === "rejection")
      await page.evaluate(() => window.uiStabilityFixture.rejectNextExit());
    await observeFrames(page);
    await page.getByRole("button", { name: /Back to Library/ }).click();
    await page.evaluate(() => window.uiStabilityFixture.releaseExitSave());
    await expect(page.locator(".reader-exit")).toBeVisible();
    if (interruption !== "rejection")
      await expect
        .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().destinationStarted))
        .toBe(true);
    if (interruption === "supersession")
      await page.evaluate(() => window.uiStabilityFixture.interruptExit());
    if (interruption === "archive") {
      await page.evaluate(() => {
        void window.uiStabilityFixture.switchArchive("b");
      });
      await expect(page.locator("[data-archive-blocked]")).toBeVisible();
      await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
      await library(page);
      await expect(page.locator(".sidebar")).toContainText("Synthetic b");
    } else {
      if (interruption === "supersession") {
        await expect(page.locator(".reader-exit button, .reader-exit [role=alert]")).toHaveCount(0);
        await page.clock.fastForward(15_001);
      }
      const recovery = page.getByRole("button", { name: "Return to Library", exact: true });
      await expect(recovery).toBeEnabled();
      await expect(page.getByRole("alert")).toContainText(
        interruption === "rejection" ? "The destination could not be opened" : "took too long",
      );
      await expect(page.locator(".reader-toolbar, .epub-container")).toHaveCount(0);
      await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
      await page.evaluate(() => new Promise(requestAnimationFrame));
      // Releasing the obsolete destination cannot reveal Library over the newer Reader intent.
      await expect(page.locator(".reader-exit")).toBeVisible();
      await recovery.focus();
      await page.keyboard.press("Enter");
      await library(page);
    }
    await writeFile(
      info.outputPath("interrupted-exit-frames.json"),
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { handoffFrames: unknown[] }).handoffFrames,
        ),
      ),
    );
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

test("unresolved destination has an owned deadline and retirement-free retry", async ({
  page,
}, info) => {
  await page.goto(`${fixture}?count=2&reader=sepia`, { waitUntil: "domcontentloaded" });
  await library(page);
  await openBook(page);
  await expect(page.locator(".reader-page")).toHaveAttribute("data-reader-phase", "ready");
  await page.clock.install();
  await page.evaluate(() => window.uiStabilityFixture.holdReaderExit());
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().saveStarted))
    .toBe(true);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitSave());
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().destinationStarted))
    .toBe(true);
  await expect(page.locator(".reader-exit button, .reader-exit [role=alert]")).toHaveCount(0);
  const writes = await page.evaluate(() => window.uiStabilityFixture.exitControl().saveCalls);
  await page.clock.fastForward(15_001);
  await expect(page.locator(".reader-exit [role=alert]")).toHaveText(
    "Returning to the Library took too long. Try again.",
  );
  await expect(page.locator(".reader-exit button")).toHaveCount(1);
  await expect(page.locator(".reader-exit button")).toBeFocused();
  await expect(page.locator("iframe, .reader-toolbar")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("deadline-failure.png") });
  // A new attempt uses the router's own supersession and the cached leave settlement.
  await page.locator(".reader-exit button").click();
  await expect(page.locator(".reader-exit button, .reader-exit [role=alert]")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.uiStabilityFixture.exitControl().destinationCalls))
    .toBe(2);
  expect(await page.evaluate(() => window.uiStabilityFixture.exitControl().saveCalls)).toBe(writes);
  await page.evaluate(() => window.uiStabilityFixture.releaseExitDestination());
  await library(page);
});

for (const theme of ["light", "dark", "sepia"]) {
  test(`Reader source, failure, retry and return preserve the ${theme} frame`, async ({
    page,
  }, info) => {
    await page.goto(
      `${fixture}?count=2&reader=${theme}&sourceDelay=700&sourceFailure=once&progressDelay=600`,
      { waitUntil: "domcontentloaded" },
    );
    await library(page);
    await observeFrames(page);
    await openBook(page);
    const shell = page.locator(".reader-page");
    const stage = page.locator(".reader-content-stage");
    await expect(stage.getByRole("status")).toHaveText("Opening book");
    const bounds = await stage.boundingBox();
    const color = await shell.evaluate((node) => getComputedStyle(node).backgroundColor);
    await page.screenshot({ path: info.outputPath(`${theme}-source-opening.png`) });
    await expect(page.getByRole("heading", { name: "EPUB could not be opened" })).toBeVisible();
    const recoveryColors = await stage
      .getByRole("button", { name: "Try again", exact: true })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return { foreground: style.color, background: style.backgroundColor };
      });
    const toHex = (rgb: string) =>
      `#${rgb
        .match(/\d+/g)!
        .slice(0, 3)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}` as const;
    const background = toHex(recoveryColors.background);
    const recoveryContrast = themeColorContrastRatio(
      toHex(recoveryColors.foreground),
      background,
      background,
      theme === "dark" ? "dark" : "light",
    );
    expect(recoveryContrast).toBeGreaterThanOrEqual(4.5);
    await writeFile(
      info.outputPath("recovery-contrast.json"),
      JSON.stringify({ ...recoveryColors, ratio: recoveryContrast }),
    );
    expect(await stage.boundingBox()).toEqual(bounds);
    expect(await shell.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(color);
    await page.screenshot({ path: info.outputPath(`${theme}-source-error.png`) });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(stage.getByRole("status")).toHaveText("Opening book");
    await expect(page.locator(".epub-container iframe").first()).toBeVisible();
    await expect(stage.locator(".reader-loading")).toHaveCount(0);
    expect(await stage.boundingBox()).toEqual(bounds);
    await page.screenshot({ path: info.outputPath(`${theme}-reader-ready.png`) });
    await page.getByRole("button", { name: /Back to Library/ }).click();
    // Persistence is delayed. The outgoing rendition or its return status must cover the stage.
    await library(page);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            handoffFrames: Array<{ bg: string; stage: number[]; statuses: number; empty: boolean }>;
          }
        ).handoffFrames,
    );
    const framePath = info.outputPath("reader-frames.json");
    await writeFile(framePath, JSON.stringify(frames));
    await info.attach("reader-frames.json", { path: framePath, contentType: "application/json" });
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((frame) => frame.bg === color && frame.statuses <= 1 && !frame.empty)).toBe(
      true,
    );
    expect(new Set(frames.map((frame) => frame.stage.join(","))).size).toBe(1);
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

for (const count of [0, 500]) {
  test(`archive handoff retains chrome and isolates ${count} destination books`, async ({
    page,
  }) => {
    await page.goto(`${fixture}?count=2&archiveDelay=700&scanDelay=500`, {
      waitUntil: "domcontentloaded",
    });
    await library(page);
    await page
      .locator(".sidebar")
      .evaluate((node) => node.setAttribute("data-retained-shell", "true"));
    await page.evaluate((count) => {
      // Change the synthetic destination without scanning the current archive.
      window.uiStabilityFixture.setDestinationCount(count);
      void window.uiStabilityFixture.switchArchive("b");
    }, count);
    await expect(page.locator("[data-archive-blocked]")).toBeVisible();
    await expect(page.locator(".archive-handoff__workspace")).toHaveAttribute("inert", "");
    await expect(page.locator(".sidebar[data-retained-shell]")).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator(".quick-actions")).toHaveCount(0);
    await expect(page.locator("[data-archive-blocked]")).toHaveCount(0);
    if (count === 0) await expect(page.locator('[data-surface-state="empty"]')).toBeVisible();
    else
      await expect(page.locator("[data-window-total]")).toHaveAttribute(
        "data-window-total",
        String(count),
      );
    await expect(page.locator(".sidebar")).toContainText("Synthetic b");
    expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
  });
}

test("archive scan failure retains the outgoing identity and offers a contained retry", async ({
  page,
}) => {
  await page.goto(`${fixture}?count=2&scanFailure=once`, { waitUntil: "domcontentloaded" });
  await library(page);
  await page.evaluate(() => {
    void window.uiStabilityFixture.switchArchive("b");
  });
  const status = page.locator(".archive-handoff__status");
  await expect(status).toHaveAttribute("role", "alert");
  await expect(page.locator(".sidebar")).toContainText("Synthetic a");
  await status.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("[data-archive-blocked]")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toContainText("Synthetic b");
});

for (const surface of ["book dialog", "Quick Actions"]) {
  test(`archive handoff retires open native ${surface} before controls can escape inertness`, async ({
    page,
  }) => {
    await page.goto(`${fixture}?count=2&archiveDelay=900`, { waitUntil: "domcontentloaded" });
    await library(page);
    if (surface === "book dialog") await page.locator(".book-card").first().click();
    else await page.keyboard.press("Control+Shift+P");
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.evaluate(() => {
      void window.uiStabilityFixture.switchArchive("b");
    });
    await expect(page.locator("[data-archive-blocked]")).toBeVisible();
    expect(await page.locator("dialog[open]").count()).toBe(0);
    await expect(page.locator("[data-archive-blocked]")).toHaveCount(0);
    await library(page);
  });
}

test("unavailable archive recovery keeps the retiring Library chrome", async ({ page }) => {
  await page.goto(`${fixture}?count=2&archiveFailure=once`, { waitUntil: "domcontentloaded" });
  await library(page);
  await page
    .locator(".sidebar")
    .evaluate((node) => node.setAttribute("data-retained-shell", "true"));
  await page.evaluate(() => {
    void window.uiStabilityFixture.switchArchive("b");
  });
  const status = page.locator(".archive-handoff__status");
  await expect(status).toHaveAttribute("role", "alert");
  await expect(page.locator(".sidebar[data-retained-shell]")).toContainText("Synthetic a");
  await status.getByRole("button", { name: "Try again", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-archive-blocked]")).toHaveCount(0);
  await library(page);
  await expect(page.locator(".sidebar[data-retained-shell]")).toContainText("Synthetic a");
});

for (const motion of ["app-off", "system-reduced"]) {
  test(`history Back preserves the Reader stage with ${motion}`, async ({ page }, info) => {
    await page.emulateMedia({
      reducedMotion: motion === "system-reduced" ? "reduce" : "no-preference",
    });
    await page.goto(
      `${fixture}?count=2&progressDelay=700&motion=${motion === "app-off" ? "off" : "on"}`,
      { waitUntil: "domcontentloaded" },
    );
    await library(page);
    await observeFrames(page);
    await openBook(page);
    await expect(page.locator(".epub-container iframe").first()).toBeVisible();
    await page.goBack();
    await library(page);
    const frames = await page.evaluate(
      () => (window as unknown as { handoffFrames: Array<{ empty: boolean }> }).handoffFrames,
    );
    expect(frames.every((frame) => !frame.empty)).toBe(true);
    const framePath = info.outputPath("history-back-frames.json");
    await writeFile(framePath, JSON.stringify(frames));
    await info.attach("history-back-frames.json", {
      path: framePath,
      contentType: "application/json",
    });
  });
}

test("archive replacement leaves the Reader once and reveals the consistent destination", async ({
  page,
}) => {
  await page.goto(`${fixture}?count=2&progressDelay=600&archiveDelay=300&scanDelay=300`, {
    waitUntil: "domcontentloaded",
  });
  await library(page);
  await observeFrames(page);
  await openBook(page);
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await page.evaluate(() => {
    void window.uiStabilityFixture.switchArchive("b");
  });
  await expect(page.locator("[data-archive-blocked]")).toBeVisible();
  await expect(page.locator("[data-archive-blocked]")).toHaveCount(0);
  await library(page);
  await expect(page.locator(".reader-page")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toContainText("Synthetic b");
  const frames = await page.evaluate(
    () => (window as unknown as { handoffFrames: Array<{ empty: boolean }> }).handoffFrames,
  );
  expect(frames.every((frame) => !frame.empty)).toBe(true);
  expect(await page.evaluate(() => window.uiStabilityFixture.unexpected)).toEqual([]);
});
