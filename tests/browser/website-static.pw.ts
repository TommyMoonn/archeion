import fs from "node:fs";
import { expect, test } from "@playwright/test";
import registry from "../../docs/documentation/page-registry.json" with { type: "json" };

const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : [file];
  });

test("public resources and the landing runtime retain exact served bytes", async ({ request }) => {
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
    for (const article of registry.pages) {
      const old = `/archeion/documentation${article.route}`;
      const destination = `/archeion/docs${article.route}`;
      await fallbackPage.goto(old);
      const fallback = fallbackPage.getByRole("link", { name: `Continue to ${article.title}` });
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

test("docs home and brand cross the static boundary and landing links return to React docs", async ({
  page,
}) => {
  for (const label of ["Home", "Archeion Documentation"]) {
    await page.goto("/archeion/docs/");
    await expect(page.getByRole("button", { name: "Copy page", exact: true })).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(/\/archeion\/$/);
    await expect(page.locator(".hero-product")).toBeVisible();
    await page.getByRole("link", { name: "Read the documentation", exact: true }).click();
    await expect(page).toHaveURL(/\/archeion\/docs\/$/);
    await expect(page.locator("article h1")).toHaveText("Archeion documentation");
  }
  if (process.env.ARCHEION_WEBSITE_MODE !== "dev") {
    // Local serve normalizes 404.html to the landing fallback. Exercise the
    // exact generated document here; Pages/unknown-route hosting is B2.10.
    await page.route("**/archeion/404.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: fs.readFileSync("website/build/404.html"),
      }),
    );
  }
  await page.goto("/archeion/404.html");
  const homeLogo = page.locator(".navbar__brand");
  await expect(homeLogo).toHaveAttribute("href", "/archeion/");
  await expect(homeLogo).toHaveAttribute("target", "_self");
  await homeLogo.click();
  await expect(page).toHaveURL(/\/archeion\/$/);
  await expect(page.locator(".hero-product")).toBeVisible();
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
  const toggle = page.locator(".nav-toggle");
  const navigation = page.locator("#site-nav");
  await expect(navigation).toHaveAttribute("inert", "");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(navigation.getByRole("link", { name: "Library", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(navigation).toHaveAttribute("inert", "");
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
