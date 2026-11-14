import { writeFile } from "node:fs/promises";
import os from "node:os";
import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=3000";

test.beforeEach(async ({ browser }, info) => {
  await info.attach("environment.json", {
    body: JSON.stringify({
      node: process.version,
      os: os.version(),
      browser: browser.version(),
      runnerImage: process.env.ImageVersion,
    }),
    contentType: "application/json",
  });
});

async function frames(
  page: Page,
  reverse = false,
  activation: "programmatic" | "pointer" | "keyboard" = "programmatic",
  duration = 240,
  reverseRange: readonly [number, number] = [90, 200],
  controlled = !reverse,
) {
  const observation = page.evaluate(
    async ({ reverse, activation, duration, reverseRange, controlled }) => {
      const card = document.querySelector("[data-reader-book-id]")!;
      const image = card.querySelector("img");
      const url = image?.getAttribute("src");
      const toggle = document
        .querySelector<HTMLElement>(".library-titlebar-composition")!
        .querySelector<HTMLButtonElement>("button")!;
      await Promise.all(
        document
          .querySelector(".library-content--books")!
          .getAnimations()
          .map((animation) => animation.finished),
      );
      const initialY = card.getBoundingClientRect().y;
      const initialSelected = card.getAttribute("data-selected");
      const initialScrollTop = document.querySelector(".page-shell")!.scrollTop;
      const sidebar = document.querySelector(".sidebar")!;
      const initialCollapsed = sidebar.getAttribute("data-collapsed");
      const samples = [];
      if (activation === "programmatic") {
        toggle.click();
      } else {
        await new Promise<void>((resolve) => {
          toggle.addEventListener("click", () => resolve(), { once: true });
          document.documentElement.setAttribute("data-sidebar-observer-ready", "true");
        });
        document.documentElement.removeAttribute("data-sidebar-observer-ready");
      }
      const start = performance.now();
      // Flush the React commit and style change before yielding to the scheduler.
      await new Promise<void>((resolve) => {
        if (sidebar.getAttribute("data-collapsed") !== initialCollapsed) return resolve();
        const observer = new MutationObserver(() => {
          if (sidebar.getAttribute("data-collapsed") === initialCollapsed) return;
          observer.disconnect();
          resolve();
        });
        observer.observe(sidebar, { attributes: true, attributeFilter: ["data-collapsed"] });
      });
      const shell = document.querySelector(".window-app")!;
      getComputedStyle(shell).getPropertyValue("--library-sidebar-current-width");
      const travel = shell
        .getAnimations()
        .find(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === "--library-sidebar-current-width",
        );
      const held = controlled && travel;
      const travelRunning = travel?.playState === "running";
      if (held) travel.pause();
      const revealStarts = new Map<Animation, number>();
      const checkpoints = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 149, 150, 165, 180, 240];
      let checkpointIndex = 0;
      let reversed = false;
      let turn: { before: number; after: number } | null = null;
      do {
        const checkpoint = checkpoints[checkpointIndex];
        if (held) {
          travel.currentTime = checkpoint;
          // Container queries create reveal transitions as travel crosses their
          // fit gates. Advance those clocks with travel, never with runner time.
          for (const node of document.querySelectorAll(
            ".sidebar__expanded-content, .sidebar__nav .nav-item > span, .library-titlebar-composition__wordmark",
          ))
            getComputedStyle(node).getPropertyValue("opacity");
        }
        if (!held) await new Promise(requestAnimationFrame);
        if (held) {
          for (const animation of document.getAnimations()) {
            if (animation === travel || !(animation instanceof CSSTransition)) continue;
            if (!revealStarts.has(animation)) {
              revealStarts.set(animation, checkpoint);
              animation.pause();
            }
            animation.currentTime = checkpoint - revealStarts.get(animation)!;
          }
        }
        const currentSidebar = document.querySelector<HTMLElement>(".sidebar")!;
        const currentTitlebar = document.querySelector<HTMLElement>(
          ".library-titlebar-composition",
        )!;
        const currentNav = currentSidebar.querySelector<HTMLElement>(".sidebar__nav")!;
        const currentExpanded = currentSidebar.querySelector<HTMLElement>(
          ".sidebar__expanded-content",
        );
        const sidebarRect = currentSidebar.getBoundingClientRect();
        const navRect = currentNav.getBoundingClientRect();
        const width = sidebarRect.width;
        if (reverse && !reversed && width > reverseRange[0] && width < reverseRange[1]) {
          const before = width;
          toggle.click();
          await Promise.resolve();
          turn = {
            before,
            after: document.querySelector(".sidebar")!.getBoundingClientRect().width,
          };
          reversed = true;
          // Sample all geometry in the next frame, after the reversal commit.
          continue;
        }
        const label = document.querySelector(".library-titlebar-composition__wordmark");
        const wordmarkText = document.createRange();
        if (label) wordmarkText.selectNodeContents(label);
        samples.push({
          time: performance.now() - start,
          checkpoint: held ? checkpoint : null,
          travelCreated: Boolean(travel),
          travelRunning,
          turn,
          shellDuration:
            parseFloat(
              getComputedStyle(document.querySelector(".window-app")!).transitionDuration,
            ) * 1000,
          shellDelay:
            parseFloat(getComputedStyle(document.querySelector(".window-app")!).transitionDelay) *
            1000,
          initialY,
          initialSelected,
          selected: card.getAttribute("data-selected"),
          initialScrollTop,
          collapsed: currentSidebar.getAttribute("data-collapsed") === "true",
          body: sidebarRect.right,
          sidebarLeft: sidebarRect.left,
          sidebarRight: sidebarRect.right,
          direction: getComputedStyle(currentSidebar).direction,
          navBounds: { left: navRect.left, right: navRect.right },
          nav: [...currentNav.querySelectorAll<HTMLElement>(".nav-item")].map((row) => {
            const rowRect = row.getBoundingClientRect();
            const icon = row.querySelector("svg")!.getBoundingClientRect();
            const label = row.querySelector<HTMLElement>("span")!;
            const rect = label.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(label);
            const style = getComputedStyle(row);
            const iconTrack = parseFloat(style.gridTemplateColumns);
            const expectedIconCenter =
              style.direction === "rtl"
                ? rowRect.right - parseFloat(style.paddingRight) - iconTrack / 2
                : rowRect.left + parseFloat(style.paddingLeft) + iconTrack / 2;
            return {
              name: row.getAttribute("aria-label"),
              left: rowRect.left,
              right: rowRect.right,
              width: rowRect.width,
              iconCenter: icon.x + icon.width / 2,
              expectedIconCenter,
              height: rowRect.height,
              paddingLeft: style.paddingLeft,
              paddingRight: style.paddingRight,
              gap: style.columnGap,
              iconTrack,
              borderRadii: [
                style.borderTopLeftRadius,
                style.borderTopRightRadius,
                style.borderBottomRightRadius,
                style.borderBottomLeftRadius,
              ],
              labelOpacity: Number(getComputedStyle(label).opacity),
              labelVisibility: getComputedStyle(label).visibility,
              textRight: range.getBoundingClientRect().right,
              labelDisplay: getComputedStyle(label).display,
              labelClip: getComputedStyle(label).clipPath,
              labelWidth: rect.width,
              textWidth: range.getBoundingClientRect().width,
            };
          }),
          title: currentTitlebar.getBoundingClientRect().right,
          y: card.getBoundingClientRect().y,
          retained: card.isConnected && image?.getAttribute("src") === url,
          scrollTop: document.querySelector(".page-shell")!.scrollTop,
          label: Boolean(label),
          opacity: currentExpanded ? Number(getComputedStyle(currentExpanded).opacity) : 0,
          inert: currentExpanded?.hasAttribute("inert") ?? false,
          labelWidth: label?.getBoundingClientRect().width ?? 0,
          wordmarkTextWidth: wordmarkText.getBoundingClientRect().width,
          wordmarkRight: wordmarkText.getBoundingClientRect().right,
          wordmarkOpacity: label ? Number(getComputedStyle(label).opacity) : 0,
          wordmarkVisibility: label ? getComputedStyle(label).visibility : "hidden",
          hiddenFocus: Boolean(
            currentExpanded?.contains(document.activeElement) &&
            getComputedStyle(currentExpanded).visibility === "hidden",
          ),
          labelDisplay: label ? getComputedStyle(label).display : "none",
          labelClip: label ? getComputedStyle(label).clipPath : "none",
          expandedVisibility: currentExpanded
            ? getComputedStyle(currentExpanded).visibility
            : "hidden",
        });
        checkpointIndex += 1;
      } while (
        held
          ? checkpointIndex < checkpoints.length
          : performance.now() - start < duration ||
            [
              document.querySelector(".window-app")!,
              ...document.querySelectorAll(
                ".sidebar__expanded-content, .sidebar__nav .nav-item > span, .library-titlebar-composition__wordmark",
              ),
            ]
              .flatMap((node) => node.getAnimations())
              .some((animation) => animation.playState === "running" || animation.pending)
      );
      if (held) {
        travel.finish();
        for (const animation of revealStarts.keys()) animation.finish();
      }
      return samples;
    },
    { reverse, activation, duration, reverseRange, controlled },
  );
  if (activation !== "programmatic") {
    await expect(page.locator("html")).toHaveAttribute("data-sidebar-observer-ready", "true");
    const toggle = page.locator(".library-titlebar-composition button");
    if (activation === "pointer") await toggle.click();
    else {
      await toggle.focus();
      await page.keyboard.press("Enter");
    }
  }
  return observation;
}

function expectStableNavigation(trace: Awaited<ReturnType<typeof frames>>) {
  expect(trace.length).toBeGreaterThan(0);
  for (const frame of trace) {
    expect(Math.abs(frame.title - frame.body)).toBeLessThan(0.1);
    expect(frame.inert).toBe(frame.collapsed);
    expect(frame.hiddenFocus).toBe(false);
    expect(frame.labelClip).toBe("none");
    expect(frame.nav.map((row) => row.name)).toEqual(["Library", "Series", "Favorites", "Folders"]);
    for (const row of frame.nav) {
      expect(
        Math.abs(row.iconCenter - row.expectedIconCenter),
        `Icon must be centered in the leading grid track: ${JSON.stringify({
          direction: frame.direction,
          collapsed: frame.collapsed,
          sidebar: [frame.sidebarLeft, frame.sidebarRight],
          nav: [frame.navBounds.left, frame.navBounds.right],
          row: [row.left, row.right],
          iconCenter: row.iconCenter,
          expectedIconCenter: row.expectedIconCenter,
          padding: [row.paddingLeft, row.paddingRight],
          iconTrack: row.iconTrack,
        })}`,
      ).toBeLessThan(0.1);
      expect(row.iconTrack).toBe(frame.collapsed ? 43 : 20);
      expect(row.height).toBe(trace[0].nav[0].height);
      expect(row.labelClip).toBe("none");
      expect(row.left).toBeCloseTo(frame.navBounds.left, 1);
      expect(frame.navBounds.left - frame.sidebarLeft).toBeCloseTo(6, 1);
      // The nav highlight tracks the inherited, animated shell width at every
      // sampled frame. The 13px difference is the two 6px insets plus border.
      expect(row.width).toBeCloseTo(frame.body - 13, 1);
      if (frame.collapsed) {
        expect(row.paddingLeft).toBe("0px");
        expect(row.paddingRight).toBe("0px");
        expect(row.gap).toBe("0px");
        expect(row.labelDisplay).toBe("none");
        expect(new Set(row.borderRadii).size).toBe(1);
        if (Math.abs(frame.body - 56) < 0.1) {
          expect(row.right).toBeCloseTo(frame.navBounds.right, 1);
        }
      } else {
        expect(row.paddingLeft).toBe("11.5px");
        expect(row.paddingRight).toBe("11.5px");
        expect(row.gap).toBe("9px");
      }
      if (row.labelVisibility === "visible" && row.labelOpacity > 0) {
        expect(row.textRight).toBeLessThanOrEqual(frame.body + 0.1);
      }
    }
    if (frame.wordmarkVisibility === "visible" && frame.wordmarkOpacity > 0) {
      expect(frame.wordmarkRight).toBeLessThanOrEqual(frame.body + 0.1);
    }
    expect(frame.retained).toBe(true);
    expect(frame.selected).toBe(frame.initialSelected);
    expect(frame.y).toBeCloseTo(frame.initialY, 1);
    expect(frame.scrollTop).toBe(frame.initialScrollTop);
  }
}

function expectMotion(
  trace: Awaited<ReturnType<typeof frames>>,
  collapsed: boolean,
  atomic = false,
  controlled = true,
) {
  const target = collapsed ? 56 : 248;
  expect(trace.at(-1)!.body).toBe(target);
  if (atomic) expect(trace.every((frame) => frame.body === target)).toBe(true);
  else {
    const intermediate = trace.filter((frame) => frame.body > 56.1 && frame.body < 247.9);
    expect(trace[0].travelCreated, "the authored shell transition must be created").toBe(true);
    expect(trace[0].travelRunning, "the authored shell transition must run").toBe(true);
    if (controlled)
      expect(
        intermediate.length,
        "normal motion must visibly traverse intermediate widths",
      ).toBeGreaterThanOrEqual(3);
    // Check the authored timing. Wall-clock samples include CI scheduling and style-flush
    // stalls, so they remain evidence rather than a deadline for observing the endpoint.
    expect(trace[0].shellDuration).toBe(150);
    expect(trace[0].shellDelay).toBe(collapsed ? 30 : 0);
  }
  expectStableNavigation(trace);
  if (collapsed) {
    expect(
      trace.at(-1)!.nav.every((row) => row.labelOpacity === 0 && row.labelVisibility === "hidden"),
    ).toBe(true);
    expect(trace.at(-1)!.wordmarkOpacity).toBe(0);
  } else {
    expect(
      trace.at(-1)!.nav.every((row) => row.labelOpacity === 1 && row.labelVisibility === "visible"),
    ).toBe(true);
    expect(trace.at(-1)!.expandedVisibility).toBe("visible");
    expect(trace.at(-1)!.wordmarkOpacity).toBe(1);
    if (!atomic && controlled) {
      const lateExpansion = trace.filter((frame) => frame.body >= 215 && frame.body < 247.9);
      expect(lateExpansion.length).toBeGreaterThanOrEqual(2);
      const textOverlap = lateExpansion.filter(
        (frame) => frame.nav.every((row) => row.labelOpacity > 0) && frame.wordmarkOpacity > 0,
      );
      expect(
        textOverlap.length,
        "multiple intermediate widths must already reveal text",
      ).toBeGreaterThanOrEqual(2);
      const sectionOverlap = trace.filter(
        (frame) =>
          frame.body >= 230 &&
          frame.body < 247.9 &&
          frame.expandedVisibility === "visible" &&
          frame.opacity > 0,
      );
      expect(
        sectionOverlap.length,
        "expanded sections must also fade in before travel ends",
      ).toBeGreaterThanOrEqual(2);
      const firstSettled = trace.find((frame) => frame.body === target)!;
      expect(firstSettled.opacity).toBeGreaterThanOrEqual(0.95);
      expect(firstSettled.nav.every((row) => row.labelOpacity >= 0.95)).toBe(true);
      for (const frame of trace.filter((f) => f.body < 152.9)) {
        expect(frame.nav.every((row) => row.labelOpacity === 0)).toBe(true);
        expect(frame.wordmarkOpacity).toBe(0);
      }
      for (const frame of trace.filter((f) => f.body < 172.9)) {
        expect(frame.expandedVisibility).toBe("hidden");
      }
    }
  }
}

for (const scale of [1, 1.25, 1.5]) {
  test(`one sidebar width at ${scale * 100}% browser scale`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    await page.goto(fixture);
    await expect(page.locator(".book-grid")).toBeVisible();
    await expect(page.locator(".book-cover img").first()).toBeVisible();
    await page.locator(".library-content--books").evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    await page
      .locator(".sidebar__nav")
      .screenshot({ path: testInfo.outputPath("expanded-nav.png") });
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    const before = await client.send("Performance.getMetrics");
    const collapse = await frames(page, false, "pointer");
    const expand = await frames(page, false, "keyboard");
    const reversal = await frames(page, true);
    await page
      .locator(".sidebar__nav")
      .screenshot({ path: testInfo.outputPath("expanded-nav-final.png") });
    const after = await client.send("Performance.getMetrics");
    const metric = (data: typeof before, name: string) =>
      data.metrics.find((m) => m.name === name)!.value;
    const evidence = {
      scale,
      layoutDurationMs: (metric(after, "LayoutDuration") - metric(before, "LayoutDuration")) * 1000,
      layoutCount: metric(after, "LayoutCount") - metric(before, "LayoutCount"),
      collapse,
      expand,
      reversal,
    };
    const evidencePath = testInfo.outputPath("sidebar-frames.json");
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach("sidebar-frames.json", {
      path: evidencePath,
      contentType: "application/json",
    });
    for (const trace of [collapse, expand, reversal]) {
      expect(Math.max(...trace.map((f) => Math.abs(f.title - f.body)))).toBeLessThan(0.1);
      expect(trace.every((f) => f.retained && f.label)).toBe(true);
      expect(Math.max(...trace.map((f) => f.y)) - Math.min(...trace.map((f) => f.y))).toBeLessThan(
        0.1,
      );
    }
    expectMotion(collapse, true);
    expectMotion(expand, false);
    expectStableNavigation(reversal);
    const turn = reversal.find((frame) => frame.turn)?.turn;
    expect(turn).toBeTruthy();
    expect(turn!.before).toBeGreaterThan(90);
    expect(turn!.before).toBeLessThan(200);
    expect(Math.abs(turn!.after - turn!.before)).toBeLessThan(0.1);
    expect(collapse.at(-1)!.body).toBe(56);
    expect(expand.at(-1)!.body).toBe(248);
    expect(reversal.at(-1)!.body).toBe(248);
    const content = page.locator(".sidebar__expanded-content");
    const identity = await content.elementHandle();
    // Mouse and keyboard activation retain the same subtree and move focus before inerting it.
    await page.getByRole("button", { name: "Create folder", exact: true }).focus();
    await page.keyboard.press("Control+b");
    await expect(content).toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeFocused();
    await page
      .locator('.sidebar__expanded-content button[aria-label="Create folder"]')
      .evaluate((node) => (node as HTMLElement).focus());
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(content).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Create folder", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create folder", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Create folder", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect(content).toHaveAttribute("inert", "");
    expect(await identity!.evaluate((node) => node.isConnected)).toBe(true);
    await expect
      .poll(() => page.locator(".sidebar").evaluate((n) => n.getBoundingClientRect().width))
      .toBe(56);
    await page.screenshot({ path: testInfo.outputPath("collapsed.png") });
    await page
      .locator(".sidebar__nav")
      .screenshot({ path: testInfo.outputPath("collapsed-nav.png") });
    for (const name of ["Library", "Series", "Favorites", "Folders"]) {
      const control = page.locator(".sidebar__nav").getByRole("button", { name, exact: true });
      await expect(control).toHaveAccessibleName(name);
      const description = await control.getAttribute("aria-describedby");
      expect(description).not.toBeNull();
      await expect(page.locator(`[id="${description}"]`)).toHaveText(name);
    }
    await page
      .locator(".sidebar__nav")
      .getByRole("button", { name: "Library", exact: true })
      .hover();
    await expect(page.getByRole("tooltip", { name: "Library", exact: true })).toBeVisible();
    const sidebarGeometry = await page.locator(".sidebar").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, direction: getComputedStyle(node).direction };
    });
    const expectedLeadingIconCenter =
      sidebarGeometry.direction === "rtl"
        ? sidebarGeometry.right - 27.5
        : sidebarGeometry.left + 27.5;
    for (const selector of [
      ".library-titlebar-composition button",
      ".archive-switcher summary > .icon-slot",
    ]) {
      const center = await page.locator(selector).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.x + rect.width / 2;
      });
      expect(center).toBeCloseTo(expectedLeadingIconCenter, 1);
    }
    const iconCenters = await page.locator(".sidebar__nav .nav-item > svg").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return rect.x + rect.width / 2;
      }),
    );
    for (const center of iconCenters) expect(center).toBeCloseTo(expectedLeadingIconCenter, 1);
    await page.getByLabel("Current archive:", { exact: false }).click();
    await expect(page.getByRole("button", { name: "Manage archives", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]")))).toBe(
      false,
    );
    await context.close();
  });
}

test("natural sidebar travel runs to both endpoints", async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  const collapse = await frames(page, false, "pointer", 240, [90, 200], false);
  const expand = await frames(page, false, "keyboard", 240, [90, 200], false);
  expectMotion(collapse, true, false, false);
  expectMotion(expand, false, false, false);
});

for (const mode of ["off", "reduced"] as const) {
  test(`${mode} motion settles immediately`, async ({ page }) => {
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fixture}${mode === "off" ? "&motion=off" : ""}`);
    await expect(page.locator(".book-grid")).toBeVisible();
    const trace = await frames(page);
    expectMotion(trace, true, true);
  });
}

test("touch reversal and responsive crossing preserve the collapse request", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 900, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).tap();
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).tap();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).tap();
  await page.setViewportSize({ width: 559, height: 900 });
  await expect(page.locator(".sidebar__expanded-content")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("mobile-559.png") });
  await page.setViewportSize({ width: 561, height: 900 });
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator(".sidebar").evaluate((n) => n.getBoundingClientRect().width))
    .toBe(56);
  await page.screenshot({ path: testInfo.outputPath("desktop-561-compact.png") });
  await context.close();
});

for (const variant of ["list", "compact", "list-compact"] as const) {
  test(`${variant} collection retains geometry and identity`, async ({ page }, testInfo) => {
    await page.goto(fixture);
    await expect(page.locator(".book-grid")).toBeVisible();
    if (variant.includes("list")) {
      await page.evaluate(() => window.uiStabilityFixture.setView("list"));
      await expect(page.locator(".book-list")).toBeVisible();
    }
    if (variant.includes("compact")) {
      await page.locator("html").evaluate((node) => node.setAttribute("data-density", "compact"));
    }
    await page.getByRole("button", { name: "Select books", exact: true }).click();
    await page.locator(".book-card__select, .book-row__select").first().click();
    await expect(page.locator('[data-reader-book-id][data-selected="true"]')).toHaveCount(1);
    await page.locator(".page-shell").evaluate((node) => {
      node.scrollTop = 64;
    });
    await expect
      .poll(() => page.locator(".page-shell").evaluate((node) => node.scrollTop))
      .toBe(64);
    const collapse = await frames(page);
    const expand = await frames(page);
    const path = testInfo.outputPath("sidebar-frames.json");
    await writeFile(path, JSON.stringify({ variant, collapse, expand }, null, 2));
    for (const trace of [collapse, expand]) {
      expectMotion(trace, trace === collapse);
      expect(trace.every((f) => f.retained && f.label)).toBe(true);
      expect(Math.max(...trace.map((f) => Math.abs(f.title - f.body)))).toBeLessThan(0.1);
      expect(Math.max(...trace.map((f) => f.y)) - Math.min(...trace.map((f) => f.y))).toBeLessThan(
        0.1,
      );
      expect(trace.every((f) => f.scrollTop === trace[0].scrollTop)).toBe(true);
    }
  });
}

test("rapid pointer and keyboard toggles keep navigation highlights synchronized", async ({
  page,
}, testInfo) => {
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  const traces = [];
  const tracePath = testInfo.outputPath("rapid-first-frames.json");
  for (let index = 0; index < 6; index++) {
    const trace = await frames(page, false, index % 2 === 0 ? "pointer" : "keyboard", 0);
    traces.push(trace);
    await writeFile(tracePath, JSON.stringify(traces, null, 2));
    expectStableNavigation(trace);
    expect(trace[0].collapsed).toBe(index % 2 === 0);
  }
});

for (const scenario of [
  { name: "early collapse", startingCollapsed: false, range: [180, 247] },
  { name: "late collapse", startingCollapsed: false, range: [60, 110] },
  { name: "early expansion", startingCollapsed: true, range: [90, 180] },
  { name: "late expansion", startingCollapsed: true, range: [215, 247] },
] as const) {
  test(`${scenario.name} reversal has continuous width and no stale reveal`, async ({
    page,
  }, testInfo) => {
    await page.goto(fixture);
    await expect(page.locator(".book-grid")).toBeVisible();
    if (scenario.startingCollapsed) expectMotion(await frames(page), true);
    const trace = await frames(page, true, "programmatic", 360, scenario.range);
    await writeFile(testInfo.outputPath("reversal.json"), JSON.stringify(trace, null, 2));
    expectStableNavigation(trace);
    const turn = trace.find((frame) => frame.turn)?.turn;
    expect(turn).toBeTruthy();
    expect(Math.abs(turn!.after - turn!.before)).toBeLessThan(0.1);
    expect(trace.at(-1)!.body).toBe(scenario.startingCollapsed ? 56 : 248);
    expect(
      trace.at(-1)!.nav.every((row) => row.labelOpacity === (scenario.startingCollapsed ? 0 : 1)),
    ).toBe(true);
    expect(trace.at(-1)!.opacity).toBe(scenario.startingCollapsed ? 0 : 1);
  });
}

test("record actual overlapping reveal as a natural browser filmstrip", async ({
  page,
}, testInfo) => {
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  await page.locator(".library-content--books").evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
  });
  const evidence = [];
  for (const direction of ["collapse", "expand"]) {
    const trace = frames(page, false, "programmatic", 240, [90, 200], false);
    for (let index = 0; index < 7; index++) {
      const pose = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar")!;
        const expanded = document.querySelector<HTMLElement>(".sidebar__expanded-content")!;
        const target = expanded.querySelector<HTMLElement>("button")!;
        target.focus({ preventScroll: true });
        return {
          time: performance.now(),
          sidebarLeft: sidebar.getBoundingClientRect().left,
          sidebarRight: sidebar.getBoundingClientRect().right,
          direction: getComputedStyle(sidebar).direction,
          width: sidebar.getBoundingClientRect().width,
          titleWidth: document
            .querySelector(".library-titlebar-composition")!
            .getBoundingClientRect().width,
          expandedVisibility: getComputedStyle(expanded).visibility,
          expandedOpacity: Number(getComputedStyle(expanded).opacity),
          inert: expanded.hasAttribute("inert"),
          focusAccepted: document.activeElement === target,
          labels: [
            ...document.querySelectorAll(
              ".sidebar__nav .nav-item > span, .library-titlebar-composition__wordmark",
            ),
          ].map((node) => ({
            opacity: Number(getComputedStyle(node).opacity),
            visibility: getComputedStyle(node).visibility,
          })),
          centers: [...document.querySelectorAll(".sidebar__nav .nav-item > svg")].map((node) => {
            const icon = node.getBoundingClientRect();
            const row = node.parentElement!;
            const rowRect = row.getBoundingClientRect();
            const style = getComputedStyle(row);
            const track = parseFloat(style.gridTemplateColumns);
            const expected =
              style.direction === "rtl"
                ? rowRect.right - parseFloat(style.paddingRight) - track / 2
                : rowRect.left + parseFloat(style.paddingLeft) + track / 2;
            return { actual: icon.x + icon.width / 2, expected };
          }),
        };
      });
      expect(Math.abs(pose.width - pose.titleWidth)).toBeLessThan(0.1);
      expect(pose.centers.every((center) => Math.abs(center.actual - center.expected) < 0.1)).toBe(
        true,
      );
      expect(pose.focusAccepted).toBe(
        pose.expandedVisibility === "visible" && pose.expandedOpacity > 0 && !pose.inert,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${direction}-${index}.png`),
        clip: { x: 0, y: 0, width: 260, height: 420 },
      });
      evidence.push({ transitionDirection: direction, index, ...pose });
    }
    const natural = await trace;
    expectMotion(natural, direction === "collapse", false, false);
    await writeFile(
      testInfo.outputPath(`${direction}-frames.json`),
      JSON.stringify(natural, null, 2),
    );
  }
  await writeFile(testInfo.outputPath("filmstrip.json"), JSON.stringify(evidence, null, 2));
});

test("narrow desktop reveals content during expansion before its 220px endpoint", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  await frames(page);
  const trace = await frames(page);
  expectStableNavigation(trace);
  expect(trace.at(-1)!.body).toBe(220);
  expect(
    trace.some(
      (frame) =>
        frame.body > 193 &&
        frame.body < 219.9 &&
        frame.nav.every((row) => row.labelOpacity > 0) &&
        frame.opacity > 0 &&
        frame.expandedVisibility === "visible",
    ),
  ).toBe(true);
  await writeFile(testInfo.outputPath("narrow-expansion.json"), JSON.stringify(trace, null, 2));
  await page.screenshot({ path: testInfo.outputPath("narrow-expanded.png") });
});

for (const viewportWidth of [1280, 800]) {
  test(`inspect overlapping reveal at held intermediate width in ${viewportWidth}px viewport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.goto(fixture);
    await expect(page.locator(".book-grid")).toBeVisible();
    await frames(page);
    const owner = await page.evaluateHandle(async () => {
      document.querySelector<HTMLButtonElement>(".library-titlebar-composition button")!.click();
      await new Promise(requestAnimationFrame);
      const animation = document
        .querySelector(".window-app")!
        .getAnimations()
        .find(
          (a) =>
            a instanceof CSSTransition &&
            a.transitionProperty === "--library-sidebar-current-width",
        )!;
      animation.pause();
      animation.currentTime = 60;
      return animation;
    });
    await expect(page.locator(".sidebar__expanded-content")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("intermediate-reveal.png"),
      clip: { x: 0, y: 0, width: 260, height: 420 },
    });
    const pose = await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar")!;
      const expanded = document.querySelector(".sidebar__expanded-content")!;
      return {
        sidebarLeft: sidebar.getBoundingClientRect().left,
        sidebarRight: sidebar.getBoundingClientRect().right,
        direction: getComputedStyle(sidebar).direction,
        width: sidebar.getBoundingClientRect().width,
        titleWidth: document.querySelector(".library-titlebar-composition")!.getBoundingClientRect()
          .width,
        sectionOpacity: Number(getComputedStyle(expanded).opacity),
        sectionVisibility: getComputedStyle(expanded).visibility,
        labels: [
          ...document.querySelectorAll(
            ".sidebar__nav .nav-item > span, .library-titlebar-composition__wordmark",
          ),
        ].map((node) => ({
          opacity: Number(getComputedStyle(node).opacity),
          visibility: getComputedStyle(node).visibility,
        })),
        centers: [...document.querySelectorAll(".sidebar__nav .nav-item > svg")].map((node) => {
          const icon = node.getBoundingClientRect();
          const row = node.parentElement!;
          const rowRect = row.getBoundingClientRect();
          const style = getComputedStyle(row);
          const track = parseFloat(style.gridTemplateColumns);
          const expected =
            style.direction === "rtl"
              ? rowRect.right - parseFloat(style.paddingRight) - track / 2
              : rowRect.left + parseFloat(style.paddingLeft) + track / 2;
          return { actual: icon.x + icon.width / 2, expected };
        }),
      };
    });
    expect(pose.width).toBeGreaterThan(173);
    expect(pose.width).toBeLessThan(viewportWidth === 1280 ? 248 : 220);
    expect(pose.titleWidth).toBe(pose.width);
    expect(pose.labels.every((label) => label.opacity > 0 && label.visibility === "visible")).toBe(
      true,
    );
    expect(pose.sectionOpacity).toBeGreaterThan(0);
    expect(pose.centers.every((center) => Math.abs(center.actual - center.expected) < 0.1)).toBe(
      true,
    );
    await writeFile(testInfo.outputPath("intermediate-pose.json"), JSON.stringify(pose, null, 2));
    await owner.evaluate((animation) => animation.finish());
    await owner.dispose();
  });
}

test("sidebar width can be resized with pointer and keyboard and persists", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();

  const sidebar = page.locator(".sidebar");
  const shell = page.locator(".app-shell");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });

  await expect(handle).toHaveAttribute("aria-valuemin", "200");
  await expect(handle).toHaveAttribute("aria-valuemax", "360");
  await expect(handle).toHaveAttribute("aria-valuenow", "248");
  await expect(sidebar).toHaveJSProperty("offsetWidth", 248);

  await handle.hover();
  const lineTokenColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--line)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const detachedIndicatorContent = await handle.evaluate(
    (element) => getComputedStyle(element, "::after").content,
  );
  await expect(sidebar).toHaveCSS("border-inline-end-color", lineTokenColor);
  expect(detachedIndicatorContent).toBe("none");

  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds!.x + bounds!.width / 2;
  const startY = bounds!.y + Math.min(100, bounds!.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 64, startY, { steps: 8 });
  await expect(sidebar).toHaveCSS("border-inline-end-color", lineTokenColor);
  await page.mouse.up();

  await expect(handle).toHaveAttribute("aria-valuenow", "312");
  await expect(sidebar).toHaveJSProperty("offsetWidth", 312);
  await expect(shell).toHaveCSS("grid-template-columns", "312px 968px");

  await handle.focus();
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "200");
  await expect(sidebar).toHaveJSProperty("offsetWidth", 200);

  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await expect(sidebar).toHaveJSProperty("offsetWidth", 360);

  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "352");
  // The app router replaces the fixture entry URL with `/`. Re-enter the
  // instrumented fixture to exercise persistence across a real document reload.
  await page.goto(fixture);
  await expect(page.locator(".book-grid")).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
    "aria-valuenow",
    "352",
  );

  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
    "aria-valuenow",
    "352",
  );

  await page.setViewportSize({ width: 560, height: 900 });
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveCount(0);
});
