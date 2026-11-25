import { expect, test, type Locator } from "@playwright/test";

const fixture = "/tests/browser/fixtures/";
const themes = [
  { name: "dark", query: "", base: "dark" },
  { name: "light", query: "&light", base: "light" },
  { name: "custom", query: "&themeStress=distinct", base: "dark" },
] as const;

async function tokenColor(locator: Locator, token: string) {
  return locator.evaluate((node, token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    node.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

for (const theme of themes) {
  test(`shared empty and loading geometry, ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 720 });
    await page.goto(`${fixture}?view=empty-state${theme.query}`);
    const region = page.getByRole("region", { name: "Collection state" });
    const heading = region.getByRole("heading", { name: "No favorites yet" });
    await expect(heading).toBeVisible();
    const logo = page.locator(".brand-logo");
    await expect(logo.locator("img:visible")).toHaveCount(1);
    await expect(logo.locator(`.brand-logo__${theme.base}`)).toBeVisible();
    await expect(logo).toHaveCSS("width", "64px");
    await expect(logo).toHaveCSS("height", "64px");
    const empty = region.locator(".empty-state");
    await expect(empty).toHaveCSS("max-width", "410px");
    await expect(empty).toHaveCSS("padding", "32px 24px");
    await expect(empty.locator("svg").first()).toHaveCSS("width", "32px");
    await expect(heading).toHaveCSS("color", await tokenColor(heading, "--text-strong"));
    await page.getByRole("button", { name: "No matches", exact: true }).click();
    await expect(region.getByRole("heading", { name: "No matching books" })).toBeVisible();
    await expect(region.locator(".empty-state svg")).toHaveCount(0);
    await expect(region.locator(".empty-state")).toHaveCSS("padding", "24px");
    await page.getByRole("button", { name: "Loading", exact: true }).click();
    await expect(region.getByRole("status")).toHaveText("Opening book");
    await expect(region.locator(".reader-loading__line").first()).toHaveCSS("height", "8px");
    await expect(region.locator(".reader-loading__line").first()).toHaveCSS("width", "288px");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(region.locator(".reader-loading__line").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect
      .poll(() => region.evaluate((node) => node.scrollWidth <= node.clientWidth))
      .toBe(true);
  });

  test(`feedback tones retain their presentation and announcements, ${theme.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 720 });
    await page.goto(`${fixture}?view=feedback${theme.query}`);
    const feedback = page.getByRole("region", { name: "Library feedback" });
    const entries = [
      { title: "Import complete", tone: "success", token: "--success", role: "status" },
      { title: "Some books skipped", tone: "warning", token: "--accent-strong", role: "status" },
      { title: "Import failed", tone: "error", token: "--error", role: "alert" },
    ] as const;
    for (const entry of entries) {
      const item = feedback.getByRole(entry.role).filter({ hasText: entry.title });
      const title = item.getByText(entry.title, { exact: true });
      await expect(title).toHaveCSS("color", await tokenColor(title, entry.token));
      await expect(item).toHaveCSS("color", await tokenColor(item, "--text"));
      await expect(item).toHaveCSS("border-color", await tokenColor(item, "--line"));
      await expect(item).toHaveAttribute("aria-atomic", "true");
      await expect(item.getByRole("button", { name: "Dismiss feedback" })).toBeVisible();
    }
    await expect(page.getByRole("status").filter({ hasText: "Loading settings." })).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Known download progress", exact: true }),
    ).toHaveAttribute("aria-valuenow", "42");
    await expect(
      page.getByRole("progressbar", { name: "Unknown download progress", exact: true }),
    ).not.toHaveAttribute("aria-valuenow", /.+/);
    await feedback.getByRole("alert").getByRole("button", { name: "Dismiss feedback" }).click();
    await expect(feedback.getByText("Import failed")).toHaveCount(0);
    await expect(feedback.getByText("Import complete")).toBeVisible();
    await page.emulateMedia({ forcedColors: "active" });
    await expect(feedback.getByText("Some books skipped")).toBeVisible();
  });
}

test("route and recovery status pages preserve geometry, links and landmarks", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await page.goto(`${fixture}?view=not-found`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(main).toHaveCSS("min-height", "600px");
  await expect(main).toHaveCSS("padding", "32px");
  const link = main.getByRole("link", { name: "Return to library" });
  await expect(link).toHaveCSS("color", await tokenColor(link, "--accent-strong"));
  await expect(link).toHaveAttribute("href", "/");
  await page.goto(`${fixture}?view=error-boundary`);
  await expect(
    main.getByRole("heading", { name: "Archeion could not load this view" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("aria-live", "assertive");
  await expect(main.getByRole("button", { name: "Reload view" })).toBeVisible();
  await expect(main).toHaveCSS("min-height", "600px");
});
