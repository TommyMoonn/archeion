import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
});

test("local-first section presents archive-owned and application-wide storage separately", async ({
  page,
}) => {
  const section = page.locator("#local-first");

  await expect(
    section.getByRole("heading", { name: "Your EPUBs stay as normal files." }),
  ).toBeVisible();
  await expect(section.getByText("Your Archive/", { exact: true })).toBeVisible();
  await expect(
    section.locator(".archive-boundary").getByText(".archeion/", { exact: true }),
  ).toBeVisible();
  await expect(section.getByText("Archeion application data", { exact: true })).toBeVisible();
  await expect(section.getByText("No account", { exact: true })).toBeVisible();
  await expect(section.getByText("No cloud sync", { exact: true })).toBeVisible();
  await expect(section.getByText("No telemetry", { exact: true })).toBeVisible();

  await expect(section.getByText("Quick Actions", { exact: true })).toBeVisible();
  await expect(section.getByText("Standalone utility windows", { exact: true })).toBeVisible();
  await expect(section.locator(".feature-index__list article")).toHaveCount(2);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
]) {
  test(`local-first section reflows without horizontal page overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const section = page.locator("#local-first");
    await section.scrollIntoViewIfNeeded();

    await expect(section).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  });
}
