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

for (const width of [1280, 360]) {
  test(`General update preference remains visible and operable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixture);
    const control = page.getByRole("switch", { name: label, exact: true });
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(24);
    // The shared Toggle expands its visual 22px box with a pseudo-element.
    // Prove the actual 24px hit area rather than mistaking visual size for target size.
    const target = await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const height = Number.parseFloat(getComputedStyle(element, "::after").height);
      // Sample just inside the boundary; the lower edge itself is exclusive.
      const hitEdges = [-11.9, 11.9].every((offset) => {
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2 + offset,
        );
        return hit === element || (hit !== null && element.contains(hit));
      });
      return { height, hitEdges };
    });
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.hitEdges).toBe(true);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.keyboard.press("Enter");
    await expect(control).toHaveAttribute("aria-checked", "false");
    await page.screenshot({ path: testInfo.outputPath(`general-updates-${width}.png`) });
  });
}
