import { expect, test } from "@playwright/test";
import history from "../../website/src/generated/release-history.json" with { type: "json" };

const route = "/archeion/docs/changelog/";

test("canonical release history is complete and readable without JavaScript or styling", async ({
  browser,
  baseURL,
}) => {
  test.skip(process.env.ARCHEION_WEBSITE_MODE === "dev", "Static HTML is a production contract");
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.route("**/*.css", (request) => request.abort());
    await page.goto(route);
    const timeline = page.getByRole("list", { name: "Releases, newest first", exact: true });
    await expect(timeline.locator(":scope > li")).toHaveCount(history.entries.length);
    await expect(timeline.getByRole("heading", { level: 2 })).toHaveText(
      history.entries.map((entry) => `v${entry.version}`),
    );
    for (const entry of history.entries) {
      const release = timeline
        .locator(":scope > li")
        .filter({ has: page.locator(`#release-${entry.version.replaceAll(".", "-")}`) });
      await expect(release.locator("time")).toHaveAttribute("datetime", entry.date);
      await expect(release.locator("ul > li")).toHaveCount(
        entry.changes.match(/^[-*] /gm)?.length ?? 0,
      );
      await expect(
        release.getByRole("link", {
          name: `Full release notes for v${entry.version}`,
          exact: true,
        }),
      ).toHaveAttribute(
        "href",
        `https://github.com/TommyMoonn/archeion/releases/tag/v${entry.version}`,
      );
    }
    await page.getByRole("link", { name: "Link to v1.5.4", exact: true }).click();
    await expect(page).toHaveURL(/#release-1-5-4$/);
    await page.reload();
    await expect(page.locator("#release-1-5-4")).toBeInViewport();
  } finally {
    await context.close();
  }
});

test("timeline retains framework outline, canonical search sections, fragments and page copy", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(route);
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc.getByRole("link")).toHaveText(
    history.entries.map((entry) => `v${entry.version}`),
  );
  await expect(page.getByRole("button", { name: "Copy page", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  await dialog.getByRole("searchbox").fill("common English inflections");
  const result = dialog.locator('a[href$="/changelog/#release-1-3-0"]');
  await expect(result).toHaveCount(1);
  await result.press("Enter");
  await expect(page).toHaveURL(/#release-1-3-0$/);
  await expect(page.locator("#release-1-3-0")).toBeInViewport();
  await page.getByRole("button", { name: "Copy page", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Page copied");
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  for (const entry of history.entries) expect(markdown).toContain(`## v${entry.version}`);
  expect(markdown).toContain("November 14, 2026");
  expect(markdown).toContain("**Narrow**");
  expect(markdown).toContain("`Ctrl+F`");
  expect(markdown).not.toMatch(/On this page|Edit this page|Report a documentation issue/);
  expect(errors).toEqual([]);
});

for (const appearance of ["dark", "light"] as const) {
  for (const width of [1440, 800, 601, 600, 320]) {
    test(`${appearance} release timeline at ${width}px matches measured responsive structure`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((theme) => localStorage.setItem("theme", theme), appearance);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const timeline = page.getByRole("list", { name: "Releases, newest first" });
      const first = timeline.locator(":scope > li").first();
      const geometry = await first.evaluate((entry) => {
        const style = getComputedStyle(entry);
        const heading = entry.querySelector("h2");
        const date = entry.querySelector("time");
        if (!heading || !date) throw new Error("Missing release metadata");
        return {
          columns: style.gridTemplateColumns.split(" ").length,
          gap: style.gap,
          padding: style.paddingBottom,
          heading: getComputedStyle(heading).fontSize,
          date: getComputedStyle(date).fontSize,
          headingLine: getComputedStyle(heading).lineHeight,
          dateLine: getComputedStyle(date).lineHeight,
          firstBulletMargin: getComputedStyle(entry.querySelector("ul > li") ?? entry).marginTop,
        };
      });
      expect(geometry).toEqual({
        columns: width <= 600 ? 1 : 2,
        gap: width <= 600 ? "8px" : "22px",
        padding: width <= 600 ? "25px" : "32px",
        heading: "15px",
        date: "11px",
        headingLine: "18.3px",
        dateLine: "19.8px",
        firstBulletMargin: "9px",
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(first.locator("time")).toBeVisible();
      if (width === 1440 || width === 320)
        await page.screenshot({
          path: test.info().outputPath(`release-${appearance}-${width}.png`),
          fullPage: false,
        });
      const link = first.getByRole("link", {
        name: `Full release notes for v${history.entries[0].version}`,
        exact: true,
      });
      await link.focus();
      await expect(link).toBeFocused();
      expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
        "solid",
      );
    });
  }
}
