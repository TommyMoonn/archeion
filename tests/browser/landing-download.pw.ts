import { expect, test } from "@playwright/test";

const installer =
  "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe";

test("native download and footer destinations retain released distribution paths", async ({
  page,
}) => {
  await page.goto("/archeion/");
  const downloads = page.locator(`a[href="${installer}"]`);
  expect(await downloads.count()).toBe(4);
  for (const link of await downloads.all()) {
    await expect(link).not.toHaveAttribute("role", "button");
    await expect(link).not.toHaveAttribute("download", /.+/);
  }
  const footer = page.getByRole("contentinfo");
  const title = "Archeion - Local-first EPUB Library and Reader";
  const image = "https://tommymoonn.github.io/archeion/assets/archeion-preview.png";
  await expect(page).toHaveTitle(title);
  for (const [selector, value] of [
    ["meta[property='og:title']", title],
    ["meta[name='twitter:title']", title],
    ["meta[property='og:type']", "website"],
    ["meta[property='og:site_name']", "Archeion"],
    ["meta[property='og:url']", "https://tommymoonn.github.io/archeion/"],
    ["meta[property='og:image']", image],
    ["meta[name='twitter:image']", image],
    ["meta[property='og:image:width']", "1544"],
    ["meta[property='og:image:height']", "1012"],
    ["meta[name='twitter:card']", "summary_large_image"],
    ["meta[name='theme-color']", "#0b0b0c"],
  ]) {
    await expect(page.locator(selector)).toHaveCount(1);
    await expect(page.locator(selector)).toHaveAttribute("content", value);
  }
  for (const rel of ["icon", "apple-touch-icon"]) {
    await expect(page.locator(`link[rel='${rel}']`)).toHaveCount(1);
    await expect(page.locator(`link[rel='${rel}']`)).toHaveAttribute(
      "href",
      "https://tommymoonn.github.io/archeion/assets/images/archeion-icon.png",
    );
  }
  for (const [name, href] of [
    ["Documentation", "/archeion/docs/"],
    ["Source code", "https://github.com/TommyMoonn/archeion"],
    ["Releases", "https://github.com/TommyMoonn/archeion/releases"],
  ])
    await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  for (const link of await page.locator('a[target="_blank"]').all()) {
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
  }
  // Fulfil the real installer destination without downloading a release binary.
  let requested = false;
  await page.route(installer, async (route) => {
    requested = true;
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "Content-Disposition": 'attachment; filename="fixture.exe"' },
      body: "fixture",
    });
  });
  const download = page.waitForEvent("download");
  await page
    .locator("#download")
    .getByRole("link", { name: "Download for Windows", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("fixture.exe");
  expect(requested).toBe(true);
});

for (const width of [320, 390, 768, 1020, 1021, 1440]) {
  test(`navigation clears the sticky header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/archeion/");
    const navigation = page.getByRole("navigation", {
      name: width <= 1020 ? "Mobile navigation" : "Main navigation",
      includeHidden: true,
    });
    for (const [name, id] of [
      ["Library", "library"],
      ["Reading", "reading"],
      ["Your files", "files"],
    ]) {
      if (width <= 1020) await page.locator("summary").click();
      await navigation.getByRole("link", { name, exact: true, includeHidden: true }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`#${id}`)).toBeFocused();
      await expect(
        navigation.getByRole("link", { name, exact: true, includeHidden: true }),
      ).toHaveAttribute("aria-current", "location");
      expect(
        await page.locator(`#${id} h2`).evaluate((node) => node.getBoundingClientRect().top),
      ).toBeGreaterThanOrEqual(width <= 640 ? 64 : 68);
    }
  });
}
