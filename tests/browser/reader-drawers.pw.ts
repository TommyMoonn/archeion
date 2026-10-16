import { expect, test, type Page } from "@playwright/test";

type Kind = "navigation" | "search" | "annotations" | "settings";

async function motion(page: Page, action: Kind | "close", count = 24) {
  return page.evaluate(
    async ({ action, count }) => {
      const samples = [];
      const ends: Array<{ state?: string; left: number; right: number }> = [];
      const end = (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.matches(".reader-side-drawer")) {
          const rect = target.getBoundingClientRect();
          ends.push({ state: target.dataset.state, left: rect.left, right: rect.right });
        }
      };
      document.addEventListener("transitionend", end, true);
      const before = {
        stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
        resizes: window.readerDrawer.resizeCalls(),
        cfi: window.readerInteractions.location(),
      };
      if (action === "close") window.readerDrawer.close();
      else window.readerDrawer.show(action);
      for (let index = 0; index < count; index++) {
        const panel = document.querySelector<HTMLElement>(".reader-side-panel");
        const shell = document.querySelector<HTMLElement>(".reader-side-drawer");
        samples.push({
          panel: panel?.getBoundingClientRect().toJSON() ?? null,
          stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
          opacity: panel ? getComputedStyle(panel).opacity : null,
          state: shell?.dataset.state,
          inert: Boolean(panel?.closest("[inert]")),
          resizes: window.readerDrawer.resizeCalls(),
          cfi: window.readerInteractions.location(),
        });
        await new Promise(requestAnimationFrame);
      }
      document.removeEventListener("transitionend", end, true);
      return { before, samples, ends, width: innerWidth };
    },
    { action, count },
  );
}

function stableStage(result: Awaited<ReturnType<typeof motion>>) {
  for (const sample of result.samples) {
    expect(sample.stage).toEqual(result.before.stage);
    expect(sample.resizes).toBe(result.before.resizes);
    expect(sample.cfi).toBe(result.before.cfi);
  }
}

async function holdEntry(page: Page, kind: Kind, fraction: number, playbackRate = 1) {
  return page.evaluate(
    async ({ kind, fraction, playbackRate }) => {
      window.readerDrawer.show(kind);
      const drawer = document.querySelector(".reader-side-drawer")!;
      while (!drawer.getAnimations().length) await new Promise(requestAnimationFrame);
      const animation = drawer.getAnimations()[0];
      animation.playbackRate = playbackRate;
      animation.pause();
      animation.currentTime = Number(animation.effect!.getTiming().duration) * fraction;
      return drawer.getBoundingClientRect().toJSON();
    },
    { kind, fraction, playbackRate },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/reader-drawers.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.readerInteractions.location())).not.toBeNull();
  // This matrix isolates motion as before. Cold module/data readiness has its own delayed-import tests.
  await page.evaluate(() => window.readerDrawer.warmPanels());
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "on";
  });
  let previous = "";
  let stable = 0;
  await expect
    .poll(async () => {
      const value = await page.evaluate(() =>
        JSON.stringify([
          document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
          window.readerDrawer.resizeCalls(),
          window.readerInteractions.location(),
        ]),
      );
      stable = value === previous ? stable + 1 : 0;
      previous = value;
      return stable;
    })
    .toBeGreaterThanOrEqual(2);
});

for (const mode of ["continuous", "paged"] as const) {
  for (const direction of ["ltr", "rtl"] as const) {
    for (const width of [1100, 390]) {
      test(`${mode} ${direction} ${width}px: all four drawers travel fully without reflow`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(
          async ({ mode, direction }) => {
            document.documentElement.dir = direction;
            await window.readerInteractions.open("long-spine", mode);
          },
          { mode, direction },
        );
        await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
        await expect
          .poll(() => page.evaluate(() => window.readerInteractions.location()))
          .not.toBeNull();
        await expect
          .poll(() => page.evaluate(() => document.querySelector(".epub-container")!.clientWidth))
          .toBe(width);
        const evidence = [];
        for (const kind of ["navigation", "search", "annotations", "settings"] as const) {
          const entered = await motion(page, kind);
          const first = entered.samples[0].panel!;
          const last = entered.samples.at(-1)!.panel!;
          if (direction === "ltr") {
            expect(first.left).toBeGreaterThanOrEqual(width);
            expect(last.right).toBeCloseTo(width, 0);
          } else {
            expect(first.right).toBeLessThanOrEqual(0);
            expect(last.left).toBeCloseTo(0, 0);
          }
          expect(
            entered.samples.some(
              (sample) =>
                sample.panel && sample.panel.left !== first.left && sample.panel.left !== last.left,
            ),
          ).toBe(true);
          expect(entered.samples.every((sample) => sample.opacity === "1")).toBe(true);
          expect(last.width).toBe(
            width < 760 ? width - 18 : kind === "search" || kind === "annotations" ? 430 : 380,
          );
          expect(entered.samples.at(-1)!.state).toBe("open");
          stableStage(entered);
          const exited = await motion(page, "close");
          expect(exited.samples[0].panel).not.toBeNull();
          expect(exited.samples[0].inert).toBe(true);
          expect(exited.samples.at(-1)!.panel).toBeNull();
          const end = exited.ends.find((event) => event.state === "closing")!;
          expect(end).toBeDefined();
          if (direction === "ltr") expect(end.left).toBeCloseTo(width, 0);
          else expect(end.right).toBeCloseTo(0, 0);
          stableStage(exited);
          evidence.push({ kind, entered, exited });
        }
        await testInfo.attach("drawer-geometry", {
          body: JSON.stringify(evidence),
          contentType: "application/json",
        });
      });
    }
  }
}

for (const preference of ["app-off", "reduced"] as const) {
  test(`${preference}: immediate functional drawers without travel`, async ({ page }) => {
    if (preference === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    else
      await page.evaluate(() => {
        document.documentElement.dataset.motion = "off";
      });
    for (const kind of ["navigation", "search", "annotations", "settings"] as const) {
      const entered = await motion(page, kind, 3);
      expect(entered.samples.every((sample) => sample.panel?.right === entered.width)).toBe(true);
      expect(entered.ends).toEqual([]);
      stableStage(entered);
      await page.keyboard.press("Escape");
      await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
    }
  });
}

test("interrupted entry, close/reopen and switches keep the latest drawer", async ({ page }) => {
  const partial = await holdEntry(page, "navigation", 0.4);
  expect(partial.left).toBeGreaterThan((await page.evaluate(() => innerWidth)) - partial.width);
  expect(partial.left).toBeLessThan(await page.evaluate(() => innerWidth));
  const closing = await motion(page, "close", 2);
  expect(closing.samples[0].inert).toBe(true);
  await motion(page, "settings", 3);
  await motion(page, "search", 3);
  await motion(page, "annotations");
  await expect(page.locator(".reader-side-drawer")).toHaveCount(1);
  await expect(page.locator(".reader-side-panel")).toHaveAttribute("aria-label", "Annotations");
  await expect(page.locator(".reader-side-surface-layer")).not.toHaveAttribute("inert");
  await motion(page, "close");
  await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
});

test("closing content rejects focus and backdrop capture while the trigger regains focus", async ({
  page,
}) => {
  await motion(page, "search");
  const closing = await motion(page, "close", 2);
  expect(closing.samples[0].inert).toBe(true);
  const result = await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".reader-side-surface-layer")!;
    layer.querySelector<HTMLInputElement>("input")!.focus();
    return {
      captured: layer.contains(document.activeElement),
      pointerEvents: getComputedStyle(layer).pointerEvents,
      transient: layer.hasAttribute("data-application-transient"),
    };
  });
  expect(result).toEqual({ captured: false, pointerEvents: "none", transient: false });
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
});

test("motion changes and cancellation retire exits without a transition event", async ({
  page,
}) => {
  await motion(page, "settings");
  await motion(page, "close", 2);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "off";
  });
  await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "on";
  });
  await motion(page, "search");
  await motion(page, "close", 2);
  await page.evaluate(() =>
    document
      .querySelector(".reader-side-drawer")!
      .getAnimations()
      .forEach((animation) => animation.cancel()),
  );
  await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
});

test("actual teardown does not wait for drawer motion", async ({ page }) => {
  await motion(page, "settings", 3);
  await page.evaluate(() => window.readerDrawer.dispose());
  await expect(page.locator(".reader-side-surface-layer")).toHaveCount(0);
});

test("slowed drawer motion provides inspectable visual evidence", async ({ page }, testInfo) => {
  await holdEntry(page, "settings", 0.5, 0.1);
  await page.screenshot({ path: testInfo.outputPath("drawer-midpoint.png") });
  await page.evaluate(() =>
    document.querySelector(".reader-side-drawer")!.getAnimations()[0].play(),
  );
  await expect(page.locator(".reader-side-drawer")).toHaveAttribute("data-state", "open");
  await page.screenshot({ path: testInfo.outputPath("drawer-open.png") });
  await motion(page, "close");
});
