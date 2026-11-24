import { expect, test, type Locator, type Page } from "@playwright/test";
import { defaultAppPreferences } from "../../src/types/appSettings";
import { resolveBuiltInAppTheme, resolveTheme } from "../../src/themes/resolveTheme";
import { shellStressThemes } from "../fixtures/themes/shellStressThemes";

const fixture = "/tests/browser/fixtures/application-font-settings.html";

async function choose(page: Page, select: Locator, label: string) {
  await select.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(select).toHaveText(label);
}

const preferences = (page: Page) =>
  page.evaluate(() => window.applicationFontSettingsFixture.preferences);

for (const theme of ["dark", "light", "custom"] as const) {
  test(`${theme}: General and Library preferences stay contained and reflow`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${fixture}?${theme}`);
    const resolved =
      theme === "custom"
        ? resolveTheme(shellStressThemes.distinct).app
        : resolveBuiltInAppTheme(theme);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--surface-main")),
      )
      .toBe(resolved.tokens.main);
    for (const section of ["General", "Library"]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      const content = page.getByRole("region", { name: "Settings content" });
      const rows = content.locator('[role="group"][aria-labelledby]');
      await expect(rows.first()).toBeVisible();
      for (const width of [1100, 760]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await rows.evaluateAll((elements) => {
          const probe = document.createElement("span");
          probe.style.color = "var(--line)";
          document.body.append(probe);
          const line = getComputedStyle(probe).color;
          probe.remove();
          return elements.map((element) => {
            const label = document.getElementById(element.getAttribute("aria-labelledby") ?? "");
            const description = document.getElementById(
              element.getAttribute("aria-describedby") ?? "",
            );
            const control = element.querySelector(
              '[role="radiogroup"], [role="combobox"], [role="switch"], button',
            );
            if (!label || !control) throw new Error("Preference row is incomplete");
            const labelRect = label.getBoundingClientRect();
            const controlRect = control.getBoundingClientRect();
            const rowRect = element.getBoundingClientRect();
            const metaBottom = Math.max(
              labelRect.bottom,
              description?.getBoundingClientRect().bottom ?? 0,
            );
            return {
              label: label.textContent,
              sideBySide: labelRect.right <= controlRect.left + 1,
              stacked: controlRect.top >= metaBottom - 1,
              contained:
                controlRect.left >= rowRect.left - 1 && controlRect.right <= rowRect.right + 1,
              select: control.getAttribute("role") === "combobox",
              width: controlRect.width,
              rowWidth: rowRect.width,
              border: getComputedStyle(element).borderBottomColor,
              line,
            };
          });
        });
        for (const row of geometry) {
          expect(row.contained, row.label ?? "row").toBe(true);
          expect(row.border, row.label ?? "row").toBe(row.line);
          if (width === 1100) {
            expect(row.sideBySide, row.label ?? "row").toBe(true);
            if (row.select) expect(Math.abs(row.width - 240)).toBeLessThanOrEqual(1);
          } else {
            expect(row.stacked, row.label ?? "row").toBe(true);
            if (row.select) expect(Math.abs(row.width - row.rowWidth)).toBeLessThanOrEqual(1);
          }
        }
        expect(
          await content.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        ).toBe(true);
      }
    }
  });
}

test("General and Library controls update their own preferences and reset independently", async ({
  page,
}) => {
  await page.goto(fixture);
  await choose(
    page,
    page.getByRole("combobox", { name: "Startup behavior" }),
    "Show Archive Manager",
  );
  const windowBehavior = page.getByRole("group", { name: "Window behavior", exact: true });
  const remember = windowBehavior.getByRole("switch", {
    name: "Remember window size and position",
  });
  await remember.click();
  await expect(remember).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const books = page.getByRole("group", { name: "Books", exact: true });
  await books.getByRole("radio", { name: "List", exact: true }).click();
  await choose(page, books.getByRole("combobox", { name: "Default book sort" }), "Author");
  await choose(page, books.getByRole("combobox", { name: "Book card size" }), "Large");
  const folders = page.getByRole("group", { name: "Folders", exact: true });
  await folders.getByRole("radio", { name: "Cards", exact: true }).click();
  await choose(page, folders.getByRole("combobox", { name: "Default folder sort" }), "Most books");
  await choose(page, folders.getByRole("combobox", { name: "Folder card size" }), "Small");
  const series = page.getByRole("group", { name: "Series", exact: true });
  await series.getByRole("radio", { name: "List", exact: true }).click();
  await choose(page, series.getByRole("combobox", { name: "Default series sort" }), "Most volumes");
  await choose(page, series.getByRole("combobox", { name: "Series card size" }), "Large");
  await page.getByRole("switch", { name: "Show Continue Reading" }).click();
  await expect
    .poll(() => preferences(page))
    .toMatchObject({
      startupBehavior: "show-archive-manager",
      rememberWindowState: true,
      showContinueReading: false,
      library: {
        collections: {
          books: { viewMode: "list", sortBy: "author", cardSize: "large" },
          folders: { viewMode: "cards", sortBy: "most-books", cardSize: "small" },
          series: { viewMode: "list", sortBy: "most-volumes", cardSize: "large" },
        },
      },
    });
  // Search renders the same setting and must update the same preference owner.
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("book card size");
  await choose(page, page.getByRole("combobox", { name: "Book card size" }), "Small");
  await search.clear();
  await expect(books.getByRole("combobox", { name: "Book card size" })).toHaveText("Small");
  await page.getByRole("button", { name: "Reset Library" }).click();
  await expect
    .poll(() => preferences(page))
    .toMatchObject({
      library: defaultAppPreferences.library,
      showContinueReading: defaultAppPreferences.showContinueReading,
      startupBehavior: "show-archive-manager",
      rememberWindowState: true,
    });
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Reset general" }).click();
  await expect
    .poll(() => preferences(page))
    .toMatchObject({
      startupBehavior: defaultAppPreferences.startupBehavior,
      rememberWindowState: true,
    });
  await windowBehavior.getByRole("button", { name: "Reset window" }).click();
  await expect
    .poll(() => preferences(page))
    .toMatchObject({
      rememberWindowState: defaultAppPreferences.rememberWindowState,
    });
});
