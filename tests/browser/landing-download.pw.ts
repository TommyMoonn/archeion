import { expect, test } from "@playwright/test";

const exeUrl =
  "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
});

test("primary navigation matches the final landing destinations", async ({ page }) => {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link")).toHaveText([
    "Library",
    "Reader",
    "Local-first",
    "Get Started",
  ]);
  await expect(navigation.getByRole("link", { name: "Local-first", exact: true })).toHaveAttribute(
    "href",
    "#local-first",
  );
  await expect(navigation.getByRole("link", { name: "Get Started", exact: true })).toHaveAttribute(
    "href",
    "#get-started",
  );

  await page.locator("#get-started").scrollIntoViewIfNeeded();
  await expect(navigation.getByRole("link", { name: "Get Started", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("Get Started keeps the end-user path visible before developer details", async ({
  page,
}) => {
  const section = page.locator("#get-started");
  const primary = section.getByRole("link", { name: "Download for Windows", exact: true });
  const documentation = section.getByRole("link", { name: "Read the documentation", exact: true });
  const developer = section.locator("details.developer-path");
  const summary = developer.locator("summary");

  await expect(
    section.getByRole("heading", { name: "Start with the EPUBs you already have." }),
  ).toBeVisible();
  await expect(primary).toHaveAttribute("href", exeUrl);
  await expect(documentation).toBeVisible();
  await expect(section.getByText("Get Started", { exact: true })).toBeVisible();
  await expect(section.locator(".entry-points, .installer-alternative")).toHaveCount(0);
  await expect(developer).not.toHaveAttribute("open", "");
  await expect(
    section.getByText("git clone https://github.com/TommyMoonn/archeion.git"),
  ).toBeHidden();

  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press("Enter");
  await expect(developer).toHaveAttribute("open", "");
  await expect(
    section.getByText("git clone https://github.com/TommyMoonn/archeion.git"),
  ).toBeVisible();
  await expect(
    section.getByRole("link", { name: "Read the development guide", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".brand--footer")).toHaveText("Archeion");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
]) {
  test(`Get Started remains content-driven without horizontal overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const section = page.locator("#get-started");
    await section.scrollIntoViewIfNeeded();

    await expect(
      section.getByRole("link", { name: "Download for Windows", exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("link", { name: "Read the documentation", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const layout = await section.evaluate((element) => {
      const header = document.querySelector(".site-header");
      if (!header) throw new Error("Missing site header");
      const developerPath = element.querySelector(".developer-path");
      if (!developerPath) throw new Error("Missing developer disclosure");
      return {
        sectionHeight: element.getBoundingClientRect().height,
        availableHeight: window.innerHeight - header.getBoundingClientRect().height,
        bottomSpacing:
          element.getBoundingClientRect().bottom - developerPath.getBoundingClientRect().bottom,
      };
    });
    expect(layout.sectionHeight).toBeGreaterThanOrEqual(layout.availableHeight - 1);
    expect(layout.bottomSpacing).toBeGreaterThanOrEqual(72);
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 800 },
]) {
  test(`navigation aligns each section below the header at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });

    for (const id of ["library", "reader", "local-first", "get-started"]) {
      if (viewport.width <= 900) {
        await page.getByRole("button", { name: "Open navigation" }).click();
      }
      await navigation.locator(`a[href="#${id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(navigation.locator(`a[href="#${id}"]`)).toHaveAttribute(
        "aria-current",
        "true",
      );

      const offset = await page.locator(`#${id}`).evaluate((element) => {
        const header = document.querySelector(".site-header");
        if (!header) throw new Error("Missing site header");
        return element.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
      });
      expect(Math.abs(offset)).toBeLessThanOrEqual(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }

    const section = page.locator("#get-started");
    const sectionHeight = await section.evaluate((element) => element.getBoundingClientRect().height);
    const headerHeight = await page
      .locator(".site-header")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(sectionHeight).toBeGreaterThanOrEqual(viewport.height - headerHeight - 1);
  });
}
