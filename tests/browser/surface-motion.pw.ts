import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/modal-lifetime.html";
test.use({ video: "on" });

test("interrupted dialog entry keeps its displayed size through exit and mid-exit reopen", async ({
  page,
}, info) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Open surface" }).focus();
  const entering = await page.evaluate(() => {
    document.documentElement.style.setProperty("--motion-duration-fast", "1500ms");
    window.modalLifetime.show();
    const dialog = document.querySelector("dialog")!;
    const entry = dialog
      .getAnimations()
      .find((a) => (a as CSSAnimation).animationName === "dialog-presence-enter")!;
    entry.pause();
    entry.currentTime = Number(entry.effect!.getTiming().duration) * 0.4;
    return {
      bounds: dialog.getBoundingClientRect().toJSON(),
      opacity: Number(getComputedStyle(dialog).opacity),
    };
  });
  await page.keyboard.press("Escape");
  const samples = await page.locator("dialog").evaluate((dialog) => {
    const pose = () => ({
      bounds: dialog.getBoundingClientRect().toJSON(),
      opacity: Number(getComputedStyle(dialog).opacity),
    });
    const exit = dialog
      .getAnimations()
      .find((a) => (a as CSSAnimation).animationName === "dialog-exit")!;
    exit.pause();
    exit.currentTime = 0;
    const start = pose();
    exit.currentTime = Number(exit.effect!.getTiming().duration) / 2;
    const half = pose();
    window.modalLifetime.show();
    const reopened = pose();
    dialog.getAnimations({ subtree: true }).forEach((a) => a.finish());
    return { start, half, reopened };
  });
  await info.attach("interrupted-closing.json", {
    body: JSON.stringify({ entering, ...samples }, null, 2),
    contentType: "application/json",
  });
  // Computed transforms serialize to a rounded matrix when the lifecycle samples the pose.
  for (const dimension of ["x", "y", "width", "height"] as const) {
    expect(samples.start.bounds[dimension]).toBeCloseTo(entering.bounds[dimension], 2);
    expect(samples.half.bounds[dimension]).toBeCloseTo(samples.start.bounds[dimension], 2);
    expect(samples.reopened.bounds[dimension]).toBeCloseTo(samples.half.bounds[dimension], 2);
  }
  expect(samples.half.opacity).toBeLessThan(samples.start.opacity);
  expect(samples.reopened.opacity).toBeCloseTo(samples.half.opacity, 2);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open surface" })).toBeFocused();
});

for (const width of [1280, 390]) {
  test(`record actual closing frames and focus settlement at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixture);
    await page.getByRole("button", { name: "Open surface" }).click();
    await page
      .locator("dialog")
      .evaluate((dialog) => dialog.getAnimations({ subtree: true }).forEach((a) => a.finish()));
    await page.evaluate(() => {
      Object.assign(window, {
        closingFrames: new Promise((resolve) => {
          document.querySelector<HTMLButtonElement>(".dialog__footer button")!.addEventListener(
            "click",
            () => {
              const start = performance.now();
              const frames: {
                time: number;
                opacity: number;
                scrim: number;
                transform: string;
                open: boolean;
              }[] = [];
              const frame = () => {
                const dialog = document.querySelector<HTMLDialogElement>("dialog");
                if (!dialog) {
                  resolve({ frames, removedAt: performance.now() - start });
                  return;
                }
                frames.push({
                  time: performance.now() - start,
                  opacity: Number(getComputedStyle(dialog).opacity),
                  scrim: Number(getComputedStyle(dialog, "::backdrop").opacity),
                  transform: getComputedStyle(dialog).transform,
                  open: dialog.open && dialog.matches(":modal"),
                });
                requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            },
            { once: true, capture: true },
          );
        }),
      });
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const recording = await page.evaluate(
      () =>
        (
          window as unknown as {
            closingFrames: Promise<{
              frames: {
                time: number;
                opacity: number;
                scrim: number;
                transform: string;
                open: boolean;
              }[];
              removedAt: number;
            }>;
          }
        ).closingFrames,
    );
    await info.attach("closing-raf.json", {
      body: JSON.stringify(recording, null, 2),
      contentType: "application/json",
    });
    expect(recording.frames.length).toBeGreaterThan(1);
    expect(recording.frames.every((frame) => frame.open)).toBe(true);
    expect(new Set(recording.frames.map((frame) => frame.transform)).size).toBe(1);
    expect(recording.frames.at(-1)!.opacity).toBeLessThan(recording.frames[0].opacity);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open surface" })).toBeFocused();
    expect(await page.evaluate(() => window.modalLifetime.dismissals)).toBe(1);
    await page.screenshot({ path: info.outputPath("after-close.png") });
  });
}

for (const width of [1280, 390]) {
  test(`shared dialog closing fades completely with a fixed pose at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixture);
    await page.getByRole("button", { name: "Open surface" }).click();
    const samples = await page.locator("dialog").evaluate((dialog) => {
      dialog.getAnimations({ subtree: true }).forEach((a) => a.finish());
      window.modalLifetime.close();
      const animations = dialog.getAnimations({ subtree: true });
      const panel = animations.find((a) => (a as CSSAnimation).animationName === "dialog-exit")!;
      const backdrop = animations.find(
        (a) => (a as CSSAnimation).animationName === "surface-backdrop-exit",
      )!;
      panel.pause();
      backdrop.pause();
      const duration = Number(panel.effect!.getTiming().duration);
      const backdropDuration = Number(backdrop.effect!.getTiming().duration);
      const frames = [0, 0.5, 1].map((fraction) => {
        panel.currentTime = fraction * duration;
        backdrop.currentTime = fraction * backdropDuration;
        document.querySelector<HTMLButtonElement>("button")!.focus();
        return {
          fraction,
          bounds: dialog.getBoundingClientRect().toJSON(),
          opacity: Number(getComputedStyle(dialog).opacity),
          backdropOpacity: Number(getComputedStyle(dialog, "::backdrop").opacity),
          open: (dialog as HTMLDialogElement).open,
          modal: dialog.matches(":modal"),
          inert: (dialog.firstElementChild as HTMLElement).inert,
          backgroundBlocked: document.activeElement !== document.querySelector("button"),
        };
      });
      panel.finish();
      backdrop.finish();
      return { duration, backdropDuration, frames };
    });
    await info.attach("closing-positions.json", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    expect(samples.frames.at(-1)!.opacity).toBeLessThanOrEqual(0.05);
    expect(samples.frames.at(-1)!.backdropOpacity).toBeLessThanOrEqual(0.05);
    for (const frame of samples.frames) {
      expect(frame.bounds).toEqual(samples.frames[0].bounds);
      expect(frame.open && frame.modal && frame.inert && frame.backgroundBlocked).toBe(true);
    }
    expect(samples.duration).toBe(120);
    expect(samples.backdropDuration).toBe(samples.duration);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open surface" })).toBeFocused();
    expect(await page.evaluate(() => window.modalLifetime.dismissals)).toBe(1);
    expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(0);
    await page.getByRole("button", { name: "Background action" }).click();
    expect(await page.evaluate(() => window.modalLifetime.submits)).toBe(1);
  });
}

for (const width of [1280, 390]) {
  test(`opaque drawer covers the full right-edge distance at ${width}px without moving background`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${fixture}?surface=drawer`);
    const samples = await page.evaluate(() => {
      const background = () =>
        [".library-header", ".book-card"].map((selector) =>
          document.querySelector(selector)!.getBoundingClientRect().toJSON(),
        );
      const before = background();
      window.modalLifetime.show();
      const dialog = document.querySelector("dialog")!;
      const entry = dialog
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === "details-drawer-enter")!;
      entry.pause();
      const duration = Number(entry.effect!.getTiming().duration);
      const pose = () => ({
        bounds: dialog.getBoundingClientRect().toJSON(),
        opacity: getComputedStyle(dialog).opacity,
        background: background(),
        scrim: getComputedStyle(dialog, "::backdrop").opacity,
      });
      const frames = [0, 0.25, 0.5, 1].map((fraction) => {
        entry.currentTime = duration * fraction;
        return pose();
      });
      window.modalLifetime.close();
      const exit = dialog
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === "details-drawer-exit")!;
      exit.pause();
      const reverse = [0, 0.5, 1].map((fraction) => {
        exit.currentTime = duration * fraction;
        return pose();
      });
      return { before, duration, frames, reverse, viewport: innerWidth };
    });
    await info.attach("drawer-positions.json", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    expect(samples.duration).toBeGreaterThanOrEqual(200);
    expect(samples.duration).toBeLessThanOrEqual(240);
    expect(samples.frames[0].bounds.x).toBeGreaterThanOrEqual(width - 1);
    expect(samples.frames.at(-1)!.bounds.right).toBeCloseTo(width, 0);
    expect(samples.reverse.at(-1)!.bounds.x).toBeGreaterThanOrEqual(width - 1);
    expect(samples.frames[1].bounds.x).toBeGreaterThan(samples.frames[2].bounds.x);
    for (const frame of [...samples.frames, ...samples.reverse]) {
      expect(frame.opacity).toBe("1");
      expect(frame.background).toEqual(samples.before);
    }
  });
}

for (const scale of [1, 1.25, 1.5]) {
  test(`centered modal bounds and text stay proportional at emulated scale ${scale}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: scale,
      viewport: { width: 1000, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:4286${fixture}`);
    await page.addStyleTag({ content: `.dialog { font-size: ${16 * scale}px; }` });
    const samples = await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>("button")!.focus();
      window.modalLifetime.show();
      const dialog = document.querySelector("dialog")!;
      const animation = dialog
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === "dialog-presence-enter")!;
      animation.pause();
      const duration = Number(animation.effect!.getTiming().duration);
      const pose = () => ({
        bounds: dialog.getBoundingClientRect().toJSON(),
        control: dialog.querySelector("button")!.getBoundingClientRect().toJSON(),
        opacity: Number(getComputedStyle(dialog).opacity),
        origin: getComputedStyle(dialog).transformOrigin,
      });
      animation.currentTime = 0;
      const first = pose();
      animation.currentTime = duration;
      const last = pose();
      return {
        first,
        last,
        duration,
        focused: dialog.contains(document.activeElement),
        modal: dialog.matches(":modal"),
      };
    });
    await info.attach("modal-bounds.json", {
      body: JSON.stringify(samples, null, 2),
      contentType: "application/json",
    });
    expect(samples.first.bounds.width / samples.last.bounds.width).toBeCloseTo(0.97, 2);
    expect(samples.first.opacity).toBeGreaterThanOrEqual(0.9);
    expect(samples.duration).toBeGreaterThanOrEqual(160);
    expect(samples.duration).toBeLessThanOrEqual(180);
    for (const frame of [samples.first, samples.last]) {
      expect(frame.bounds.x + frame.bounds.width / 2).toBeCloseTo(500, 0);
      expect(frame.bounds.y + frame.bounds.height / 2).toBeCloseTo(400, 0);
      expect((frame.control.x - frame.bounds.x) / frame.bounds.width).toBeCloseTo(
        (samples.last.control.x - samples.last.bounds.x) / samples.last.bounds.width,
        3,
      );
    }
    expect(samples.focused && samples.modal).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open surface" })).toBeFocused();
    await context.close();
  });
}

test("one scrim survives nesting and replacement without a fade flash", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "Open surface" }).click();
  await page
    .locator("dialog")
    .evaluate((dialog) => dialog.getAnimations().forEach((a) => a.finish()));
  await page.getByRole("button", { name: "Open nested" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  expect(
    await page.locator("dialog").evaluateAll((dialogs) =>
      dialogs.map((d) => ({
        owner: d.getAttribute("data-backdrop-owner"),
        color: getComputedStyle(d, "::backdrop").backgroundColor,
        blur: getComputedStyle(d, "::backdrop").backdropFilter,
      })),
    ),
  ).toEqual([
    { owner: "true", color: expect.any(String), blur: "none" },
    { owner: "false", color: "rgba(0, 0, 0, 0)", blur: "none" },
  ]);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  expect(
    await page.locator("dialog").evaluate((d) => getComputedStyle(d, "::backdrop").opacity),
  ).toBe("1");
  const opacity = await page.evaluate(() => {
    window.modalLifetime.show("replacement");
    return getComputedStyle(document.querySelector("dialog")!, "::backdrop").opacity;
  });
  expect(Number(opacity)).toBeGreaterThan(0.98);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Background action" }).click();
});

for (const surface of ["dialog", "drawer", "palette"]) {
  test(`${surface}: backdrop reverses from its displayed opacity`, async ({ page }) => {
    await page.goto(`${fixture}?surface=${surface}`);
    const values = await page.evaluate(() => {
      window.modalLifetime.show();
      const dialog = document.querySelector("dialog")!;
      const scrim = dialog
        .getAnimations({ subtree: true })
        .find((a) => (a as CSSAnimation).animationName === "surface-backdrop-enter")!;
      scrim.pause();
      scrim.currentTime = Number(scrim.effect!.getTiming().duration) / 4;
      const backdrop = getComputedStyle(dialog, "::backdrop");
      const before = Number(backdrop.opacity);
      const blur = backdrop.backdropFilter;
      const color = backdrop.backgroundColor;
      const probe = document.createElement("div");
      probe.style.background = "var(--backdrop)";
      document.body.append(probe);
      const sharedColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      window.modalLifetime.close();
      const closing = Number(getComputedStyle(dialog, "::backdrop").opacity);
      window.modalLifetime.show();
      const reopened = Number(getComputedStyle(dialog, "::backdrop").opacity);
      return { before, closing, reopened, blur, color, sharedColor };
    });
    expect(values.before).toBeGreaterThan(0);
    expect(values.before).toBeLessThan(1);
    expect(values.closing).toBeCloseTo(values.before, 2);
    expect(values.reopened).toBeCloseTo(values.closing, 2);
    expect(values.blur).toBe("none");
    expect(values.color).toBe(values.sharedColor);
  });
}

for (const surface of ["dialog", "drawer"]) {
  test(`${surface}: record cold and warm input-to-paint frames`, async ({ page }, info) => {
    await page.goto(`${fixture}?surface=${surface}`);
    const runs = [];
    for (const route of ["cold", "warm"]) {
      await page.evaluate(() => {
        Object.assign(window, {
          motionFrames: new Promise((resolve) => {
            document.querySelector("button")!.addEventListener(
              "click",
              () => {
                const start = performance.now();
                const frames: {
                  time: number;
                  x: number;
                  width: number;
                  opacity: string;
                  scrim: string;
                  headerY: number;
                  cardY: number;
                }[] = [];
                const frame = () => {
                  const dialog = document.querySelector("dialog")!;
                  const bounds = dialog.getBoundingClientRect();
                  frames.push({
                    time: performance.now() - start,
                    x: bounds.x,
                    width: bounds.width,
                    opacity: getComputedStyle(dialog).opacity,
                    scrim: getComputedStyle(dialog, "::backdrop").opacity,
                    headerY: document.querySelector(".library-header")!.getBoundingClientRect().y,
                    cardY: document.querySelector(".book-card")!.getBoundingClientRect().y,
                  });
                  if (performance.now() - start < 300) requestAnimationFrame(frame);
                  else resolve(frames);
                };
                requestAnimationFrame(frame);
              },
              { once: true, capture: true },
            );
          }),
        });
      });
      await page.getByRole("button", { name: "Open surface" }).click();
      const frames = await page.evaluate(
        () =>
          (
            window as unknown as {
              motionFrames: Promise<{ time: number; headerY: number; cardY: number }[]>;
            }
          ).motionFrames,
      );
      expect(frames.length).toBeGreaterThan(1);
      expect(new Set(frames.map((f) => f.headerY)).size).toBe(1);
      expect(new Set(frames.map((f) => f.cardY)).size).toBe(1);
      runs.push({ route, frames });
      await page.screenshot({ path: info.outputPath(`${route}-settled.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog")).toHaveCount(0);
    }
    await info.attach("input-to-paint.json", {
      body: JSON.stringify(runs, null, 2),
      contentType: "application/json",
    });
  });
}
