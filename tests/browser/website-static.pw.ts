import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { documents } from "../documentationMdxTestSupport";

const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });

test("public resources retain exact served bytes", async ({ request }) => {
  for (const file of files("website/static")) {
    if (file.includes("/documentation/")) continue;
    const response = await request.get(`/archeion/${file.slice("website/static/".length)}`);
    expect(response.status(), file).toBe(200);
    expect((await response.body()).equals(fs.readFileSync(file)), file).toBe(true);
  }
});

test("legacy routes preserve query and fragment with visible script-free fallbacks", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallbackPage = await context.newPage();
    for (const { metadata: article } of documents) {
      const old = `/archeion/documentation${article.slug}`;
      const destination = `/archeion/docs${article.slug}`;
      await fallbackPage.goto(old);
      const fallback = fallbackPage.getByRole("link", {
        name: `Continue to ${article.sidebar_label}`,
      });
      await expect(fallback).toBeVisible();
      await expect(fallback).toHaveAttribute("href", destination);
      const fragment = article.id === "changelog" ? "release-1-8-0" : "preserved-fragment";
      await page.goto(`${old}?source=legacy#${fragment}`);
      await expect(page).toHaveURL(new RegExp(`${destination}\\?source=legacy#${fragment}$`));
      await expect(page.locator("article h1")).toBeVisible();
    }
    await page.goto("/archeion/documentation/changelog/#release-1-8-0");
    await expect(page.locator("#release-1-8-0")).toBeInViewport();
    await page.goto("/archeion/documentation/getting-started/installing/#after-installing");
    await expect(page.locator("#after-installing")).toBeAttached();
  } finally {
    await context.close();
  }
});

test("docs home and brand reach the React landing and return to docs", async ({ page }) => {
  for (const label of ["Home", "Archeion Documentation"]) {
    await page.goto("/archeion/docs/");
    await expect(page.getByRole("button", { name: "Copy page", exact: true })).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(/\/archeion\/$/);
    await expect(
      page.getByRole("heading", { name: "The EPUB library for Windows.", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Documentation", exact: true }).click();
    await expect(page).toHaveURL(/\/archeion\/docs\/$/);
    await expect(page.locator("article h1")).toHaveText("Archeion documentation");
  }
  await page.goto("/archeion/404.html");
  const homeLogo = page.getByRole("link", { name: "Archeion home", exact: true });
  await expect(homeLogo).toHaveAttribute("href", "/archeion/");
  await expect(homeLogo).toHaveAttribute("target", "_self");
  await homeLogo.click();
  await expect(page).toHaveURL(/\/archeion\/$/);
  await expect(
    page.getByRole("heading", { name: "The EPUB library for Windows.", exact: true }),
  ).toBeVisible();
});

test("landing mobile navigation retains keyboard focus and reduced motion", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.goto("/archeion/");
  const toggle = page.locator("summary[aria-controls=landing-mobile-navigation]");
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation).toBeHidden();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(navigation.getByRole("link", { name: "Library", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(navigation).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("static-landing-mobile.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/archeion/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveTitle("Archeion - Local-first EPUB Library and Reader");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://tommymoonn.github.io/archeion/",
  );
  await page.screenshot({ path: testInfo.outputPath("static-landing-desktop.png") });
  expect(failures).toEqual([]);
});

test("filesystem hosting returns the branded 404 at unknown nested URLs", async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.skip(
    process.env.ARCHEION_WEBSITE_MODE === "dev",
    "HTTP status contract requires the production artifact host",
  );
  const unknown = "/archeion/docs/missing/nested/page/?source=404#retained";
  const response = await page.goto(unknown);
  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL(new RegExp("/docs/missing/nested/page/\\?source=404#retained$"));
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const home = page
    .getByRole("navigation", { name: "Find a page" })
    .getByRole("link", { name: "Home", exact: true });
  await expect(home).toHaveAttribute("href", "/archeion/");
  await home.focus();
  await expect(home).toBeFocused();
  await expect(home).toHaveCSS("outline-style", "solid");
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page.locator("article h1")).toHaveText("Archeion documentation");
  await page.reload();
  await expect(page.locator("article h1")).toHaveText("Archeion documentation");
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const fallback = await context.newPage();
    expect((await fallback.goto(unknown))?.status()).toBe(404);
    await expect(fallback.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(
      fallback.getByRole("link", { name: "Documentation", exact: true }),
    ).toHaveAttribute("href", "/archeion/docs/");
  } finally {
    await context.close();
  }
  for (const url of [
    "/archeion/missing.js",
    "/archeion/assets/missing.png",
    "/archeion/docs/foundation/",
  ]) {
    expect((await request.get(url)).status(), url).toBe(404);
  }
  for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(unknown);
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`404-${theme}.png`) });
  }
});

test("React landing menu owns focus, dismissal, anchors, and breakpoint cleanup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/archeion/");
  const toggle = page.locator("summary[aria-controls=landing-mobile-navigation]");
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await toggle.click();
  await expect(menu.getByRole("link", { name: "Library", exact: true })).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Shift+Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(menu.getByRole("link", { name: "Download for Windows", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert");
  await toggle.click();
  await menu.getByRole("link", { name: "Reading", exact: true }).click();
  await expect(page).toHaveURL(/#reading$/);
  await expect(page.locator("#reading")).toBeFocused();
  await expect(menu).toBeHidden();
  await toggle.click();
  await page.mouse.click(20, 30);
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await toggle.click();
  await expect(menu).toBeHidden();
  await toggle.click();
  await page.setViewportSize({ width: 1021, height: 844 });
  await expect(menu).toBeHidden();
  await expect(page.getByRole("link", { name: "Archeion home", exact: true })).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert");
  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
});

test("React landing restores focus when the breakpoint hides the focused mobile menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Model the browser clearing focus before the application's media-query handler.
    matchMedia("(min-width: 1021px)").addEventListener("change", (event) => {
      const focused = document.activeElement;
      if (event.matches && focused instanceof HTMLElement) focused.blur();
    });
  });
  await page.goto("/archeion/");
  await page.locator("summary[aria-controls=landing-mobile-navigation]").click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu.getByRole("link", { name: "Library", exact: true })).toBeFocused();

  await page.setViewportSize({ width: 1021, height: 844 });
  await expect(page.getByRole("link", { name: "Archeion home", exact: true })).toBeFocused();
  await expect(menu).toBeHidden();
  await expect(page.locator("main")).not.toHaveAttribute("inert");
  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
});

test("React landing preserves static content, claims, native destinations and metadata", async ({
  page,
  browser,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("/archeion/");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("The EPUB library for Windows.");
  await expect(page.locator("article")).toHaveCount(6);
  for (const title of [
    "Folders and series",
    "Search and filters",
    "Batch actions",
    "Reader settings",
    "Bookmarks and highlights",
    "Offline dictionaries",
  ]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  await expect(
    page.getByText(/For books in your active archive, save reading positions/),
  ).toBeVisible();
  const preview = page
    .getByRole("region", { name: "Archeion application preview" })
    .getByRole("img");
  await expect(preview).toHaveAttribute("loading", "eager");
  expect(
    await preview.evaluate(
      (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(
    page.locator("main button, main input, main [role=tab], main [role=slider]"),
  ).toHaveCount(0);
  for (const link of await page
    .getByRole("link", { name: "Download for Windows", exact: true })
    .all()) {
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe",
    );
    await expect(link).not.toHaveAttribute("download");
  }
  await expect(page.getByRole("link", { name: "Documentation", exact: true })).toHaveAttribute(
    "href",
    "/archeion/docs/",
  );
  const description =
    "Archeion is a local-first Windows desktop app for organizing and reading EPUB libraries. Keep your books as normal files, with no account, cloud service, or telemetry.";
  await expect(page).toHaveTitle("Archeion - Local-first EPUB Library and Reader");
  for (const selector of [
    "meta[name=description]",
    "meta[property='og:description']",
    "meta[name='twitter:description']",
  ]) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute("content", description);
  }
  for (const name of [
    "og:title",
    "og:type",
    "og:site_name",
    "og:url",
    "og:image",
    "og:image:width",
    "og:image:height",
  ])
    await expect(page.locator(`meta[property='${name}']`)).toHaveCount(1);
  for (const name of ["twitter:card", "twitter:title", "twitter:image", "theme-color"])
    await expect(page.locator(`meta[name='${name}']`)).toHaveCount(1);
  await expect(page.locator("link[rel=canonical]")).toHaveCount(1);
  await expect(page.locator("link[rel=apple-touch-icon]")).toHaveCount(1);
  await expect(page.locator("meta[property='og:image']")).toHaveAttribute(
    "content",
    "https://tommymoonn.github.io/archeion/assets/archeion-preview.png",
  );
  expect(failures).toEqual([]);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto("/archeion/");
    await expect(staticPage.locator("h1")).toBeVisible();
    await staticPage.locator("summary").click();
    await expect(staticPage.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    await staticPage
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(staticPage).toHaveURL(/#library$/);
    await expect(staticPage.locator("article")).toHaveCount(6);
  } finally {
    await context.close();
  }
});

test("landing dark appearance preserves docs light preference and legacy fragments", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.goto("/archeion/docs/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("banner").getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator("[data-landing]")).toHaveCSS("background-color", "rgb(11, 11, 12)");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  for (const id of ["reader", "local-first", "get-started", "main-content"]) {
    await page.goto(`/archeion/#${id}`);
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("landing pointer effects stop immediately when reduced motion changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/archeion/");
  const landing = page.locator("[data-landing]");
  await expect
    .poll(() =>
      landing.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBeGreaterThan(0);
  const preview = page.getByRole("region", { name: "Archeion application preview" });
  await preview.hover({ position: { x: 50, y: 50 } });
  await expect(preview.locator("div")).not.toHaveCSS("transform", "none");
  const spotlight = landing.locator(":scope > svg");
  await expect(spotlight).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spotlight).toHaveCount(0);
  await expect(preview.locator("div")).toHaveCSS("transform", "none");
  await expect
    .poll(() =>
      landing.evaluate(
        (node) =>
          node
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Wait for preference listeners and their bounded reset frame without moving the pointer.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(spotlight).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("#reading-title")).toHaveText("Read and annotate your books.");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Library", exact: true })
    .click();
  await expect(page.locator("#library")).toBeFocused();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await page.getByRole("link", { name: "Back to top", exact: true }).click();
  await expect(page.locator("#top")).toBeFocused();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .locator("[aria-current]"),
  ).toHaveCount(0);
});

test("landing measured layout preserves intrinsic media and responsive boundaries", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/archeion/");
  const preview = page
    .getByRole("region", { name: "Archeion application preview" })
    .getByRole("img");
  await expect(preview).toHaveAttribute("src", "/archeion/assets/images/landing-library.webp");
  expect(
    await preview.evaluate(
      (node) => node instanceof HTMLImageElement && [node.naturalWidth, node.naturalHeight],
    ),
  ).toEqual([1480, 906]);
  for (const width of [
    320, 359, 360, 361, 390, 639, 640, 641, 768, 899, 900, 901, 1019, 1020, 1021, 1099, 1100, 1101,
    1280, 1440,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px overflow`,
    ).toBe(true);
    const geometry = await preview.boundingBox();
    expect(geometry).not.toBeNull();
    const expectedWidth =
      width <= 640
        ? width - 32
        : width <= 900
          ? Math.min(820, width - 48)
          : Math.min(1280, width - 64);
    expect(geometry?.width, `${width}px preview`).toBeCloseTo(expectedWidth, 0);
    const heading = page.locator("#library-title");
    const content = await heading.locator("..").boundingBox();
    expect(content?.width, `${width}px content`).toBeCloseTo(
      width <= 360
        ? width - 32
        : width <= 640
          ? width - 40
          : width <= 900
            ? Math.min(760, width - 48)
            : Math.min(1280, width - 64),
      0,
    );
    await expect(page.getByRole("banner")).toHaveCSS("height", width <= 640 ? "64px" : "68px");
    if ([390, 768, 1440].includes(width))
      await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
  }
});
