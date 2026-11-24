import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/application-font-settings.html";
const label = "Automatically check for updates";

test("General update preference supports keyboard activation, persistence, search, and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  const updaterRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("github.com") || request.url().includes("latest.json"))
      updaterRequests.push(request.url());
  });
  await page.goto(fixture);
  const control = page.getByRole("switch", { name: label, exact: true });
  await expect(control).toHaveAttribute("aria-checked", "true");
  await control.focus();
  await page.keyboard.press("Space");
  await expect(control).toHaveAttribute("aria-checked", "false");
  await expect(control).toBeFocused();
  await page.reload();
  await expect(control).toHaveAttribute("aria-checked", "false");
  const search = page.getByRole("searchbox", { name: "Search settings", exact: true });
  await search.fill("updates");
  await expect(page.getByRole("region", { name: "General settings search results" })).toBeVisible();
  await expect(control).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Reset general", exact: true }).click();
  await expect(control).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
  expect(updaterRequests).toEqual([]);
});

test("General update preference remains keyboard operable in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(fixture);
  const control = page.getByRole("switch", { name: label, exact: true });
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error("Update switch is missing");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect(control).toHaveAttribute("aria-checked", "false");
});
