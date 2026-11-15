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
  await page.goto("/archeion/404.html");
  const homeLogo = page.getByRole("link", { name: "Archeion home", exact: true });
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
