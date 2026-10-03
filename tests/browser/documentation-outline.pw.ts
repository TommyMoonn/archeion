import { expect, test, type Page } from "@playwright/test";

test.beforeEach(() => test.slow());

const desktop = "[data-toc]";
const current = (page: Page, target = desktop) =>
  page.locator(`${target} a[aria-current="location"]`);

async function open(page: Page, route = "guides/reading/", width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/docs/documentation/${route}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await expect(current(page)).toHaveCount(1);
}

async function align(page: Page, index: number) {
  return page.evaluate((index) => {
    const headings = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-doc-article] h2[id], [data-doc-article] h3[id]",
      ),
    ];
    const anchor = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    window.scrollTo({
      top: scrollY + headings[index].getBoundingClientRect().top - anchor + 1,
      behavior: "instant",
    });
    return `#${headings[index].id}`;
  }, index);
}

async function indicatorAligned(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const indicator = document
          .querySelector(".docs-outline-indicator")!
          .getBoundingClientRect();
        const link = document
          .querySelector('[data-toc] a[aria-current="location"]')!
          .getBoundingClientRect();
        return (
          Math.abs(indicator.top - link.top) < 1 && Math.abs(indicator.height - link.height) < 1
        );
      }),
    )
    .toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`outline tracks dense and sparse sections in both directions (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((theme) => localStorage.setItem("archeion-docs-theme", theme), theme);
    await open(page);
    const headings = page.locator("[data-doc-article] h2[id], [data-doc-article] h3[id]");
    await expect(current(page)).toHaveAttribute(
      "href",
      `#${await headings.first().getAttribute("id")}`,
    );
    for (const index of [1, 2, 3, 4, 6, 3, 0]) {
      const hash = await align(page, index);
      await expect(current(page)).toHaveAttribute("href", hash);
      await expect(current(page, "[data-mobile-toc]")).toHaveAttribute("href", hash);
      await indicatorAligned(page);
    }
    await page
      .locator(".docs-outline")
      .screenshot({ path: test.info().outputPath(`outline-${theme}.png`) });
  });

  test(`one indicator animates, retargets, and follows wrapped link geometry (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript((theme) => localStorage.setItem("archeion-docs-theme", theme), theme);
    await open(page, "reference/archive-storage/");
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe("smooth");
    const indicator = page.locator(".docs-outline-indicator");
    await expect(indicator).toHaveCount(1);
    await expect(indicator).toHaveAttribute("aria-hidden", "true");
    await indicatorAligned(page);
    const initial = await indicator.boundingBox();
    const hash = await align(page, 4);
    await expect(current(page)).toHaveAttribute("href", hash);
    const transitions = await indicator.evaluate((element) =>
      element.getAnimations().map((animation) => ({
        property: (animation as CSSTransition).transitionProperty,
        duration: animation.effect?.getTiming().duration,
      })),
    );
    expect(
      transitions.some(
        (transition) => transition.property === "transform" && Number(transition.duration) > 0,
      ),
    ).toBe(true);
    // Inspect an actual transition at 10% playback speed, then retarget it.
    await indicator.evaluate((element) =>
      element.getAnimations().forEach((animation) => {
        animation.playbackRate = 0.1;
      }),
    );
    await page
      .locator(".docs-outline")
      .screenshot({ path: test.info().outputPath(`outline-moving-${theme}.png`) });
    const next = await align(page, 2);
    await expect(current(page)).toHaveAttribute("href", next);
    await indicator.evaluate((element) =>
      element.getAnimations().forEach((animation) => {
        animation.playbackRate = 1;
      }),
    );
    await indicatorAligned(page);
    expect((await indicator.boundingBox())!.y).not.toBe(initial!.y);
    const hierarchy = await page.locator(`${desktop} a`).evaluateAll((links) => {
      const primary = getComputedStyle(
        links.find((link) => (link as HTMLElement).dataset.level === "2")!,
      );
      const secondary = getComputedStyle(
        links.find((link) => (link as HTMLElement).dataset.level === "3")!,
      );
      return {
        primaryWeight: primary.fontWeight,
        secondaryWeight: secondary.fontWeight,
        primaryInset: primary.paddingInlineStart,
        secondaryInset: secondary.paddingInlineStart,
      };
    });
    expect(Number(hierarchy.primaryWeight)).toBeGreaterThan(Number(hierarchy.secondaryWeight));
    expect(parseFloat(hierarchy.secondaryInset)).toBeGreaterThan(
      parseFloat(hierarchy.primaryInset),
    );
  });
}

for (const route of [
  "getting-started/installing/",
  "guides/reading/",
  "reference/archive-storage/",
]) {
  test(`last section owns document bottom on ${route}`, async ({ page }) => {
    await open(page, route);
    const id = await page
      .locator("[data-doc-article] h2[id], [data-doc-article] h3[id]")
      .last()
      .getAttribute("id");
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect(current(page)).toHaveAttribute("href", `#${id}`);
    await expect(current(page, "[data-mobile-toc]")).toHaveAttribute("href", `#${id}`);
    if (route === "guides/reading/") {
      expect(
        await page.locator(`#${id}`).evaluate((element) => element.getBoundingClientRect().top),
      ).toBeGreaterThan(
        await page.evaluate(() =>
          parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
        ),
      );
    }
    await indicatorAligned(page);
    await page.screenshot({ path: test.info().outputPath(`bottom-${route.split("/")[1]}.png`) });
  });
}

for (const width of [320, 1280]) {
  test(`native outline activation clears fixed header at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "guides/reading/", width);
    const target = width === 320 ? "[data-mobile-toc]" : desktop;
    if (width === 320) await page.locator("[data-mobile-outline] summary").click();
    const link = page.locator(`${target} a`).nth(3);
    const href = (await link.getAttribute("href"))!;
    await link.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(current(page, target)).toHaveAttribute("href", href);
    const heading = page.locator(href);
    const geometry = await heading.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      headerBottom: document.querySelector(".docs-header")!.getBoundingClientRect().bottom,
      clearance: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    }));
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerBottom + 20);
    expect(Math.abs(geometry.top - geometry.clearance)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`anchor-${width}.png`) });
  });
}

test("reduced motion disables indicator movement but retains current section", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const hash = await align(page, 5);
  await expect(current(page)).toHaveAttribute("href", hash);
  await indicatorAligned(page);
  const motion = await page.locator(".docs-outline-indicator").evaluate((element) => ({
    transition: getComputedStyle(element).transitionProperty,
    animations: element.getAnimations().length,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  expect(motion).toEqual({ transition: "none", animations: 0, scroll: "auto" });
});

test("indicator geometry updates after outline text reflow without a scroll", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "reference/archive-storage/");
  await indicatorAligned(page);
  const initialHeight = (await page.locator(".docs-outline-indicator").boundingBox())!.height;
  await page.locator(`${desktop} a`).evaluateAll((links) => {
    links.forEach((link) => {
      (link as HTMLElement).style.fontSize = "24px";
    });
  });
  await expect
    .poll(async () => (await page.locator(".docs-outline-indicator").boundingBox())!.height)
    .toBeGreaterThan(initialHeight);
  await indicatorAligned(page);
  await page
    .locator(".docs-outline")
    .screenshot({ path: test.info().outputPath("outline-reflow.png") });
});

test("outline state survives deep links, resizing and forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/docs/documentation/guides/reading/#highlights-notes");
  await expect(current(page)).toHaveAttribute("href", "#highlights-notes");
  await indicatorAligned(page);
  await current(page).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(current(page)).toBeFocused();
  await expect
    .poll(() => current(page).evaluate((element) => element.matches(":focus-visible")))
    .toBe(true);
  // Inspect the painted keyboard state, rather than the transient native focus ring.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const styles = await current(page).evaluate((element) => ({
    weight: getComputedStyle(element).fontWeight,
    focusWidth: getComputedStyle(element).outlineWidth,
    focusStyle: getComputedStyle(element).outlineStyle,
    indicator: getComputedStyle(document.querySelector(".docs-outline-indicator")!).backgroundColor,
    surface: getComputedStyle(document.body).backgroundColor,
  }));
  expect(Number(styles.weight)).toBeGreaterThanOrEqual(600);
  expect(parseFloat(styles.focusWidth)).toBeGreaterThanOrEqual(2);
  expect(styles.focusStyle).toBe("solid");
  expect(styles.indicator).not.toBe(styles.surface);
  const focusContained = await current(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const extension = Math.max(0, parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth));
    const link = element.getBoundingClientRect();
    const panel = element.closest(".docs-outline")!.getBoundingClientRect();
    return {
      extension,
      linkLeft: link.left,
      linkRight: link.right,
      panelLeft: panel.left,
      panelRight: panel.right,
      offset: style.outlineOffset,
      width: style.outlineWidth,
    };
  });
  expect(
    focusContained.linkLeft - focusContained.extension,
    JSON.stringify(focusContained),
  ).toBeGreaterThanOrEqual(focusContained.panelLeft);
  expect(
    focusContained.linkRight + focusContained.extension,
    JSON.stringify(focusContained),
  ).toBeLessThanOrEqual(focusContained.panelRight);
  await page
    .locator(".docs-outline")
    .screenshot({ path: test.info().outputPath("outline-forced.png") });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator("[data-mobile-outline] summary").click();
  const mobileHash = await current(page, "[data-mobile-toc]").getAttribute("href");
  await page.setViewportSize({ width: 1280, height: 700 });
  await expect(current(page)).toHaveCount(1);
  await indicatorAligned(page);
  expect(mobileHash).not.toBeNull();
});
