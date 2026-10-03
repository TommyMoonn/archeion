import { expect, test } from "@playwright/test";
import registry from "../../docs/documentation/page-registry.json" with { type: "json" };

const pages = [...registry.groups]
  .sort((a, b) => a.order - b.order)
  .flatMap((group) =>
    registry.pages.filter((page) => page.group === group.id).sort((a, b) => a.order - b.order),
  );

test("every documentation page publishes its sidebar and pager before JavaScript executes", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    for (const [index, entry] of pages.entries()) {
      await page.goto(`/docs/documentation${entry.route}`, { waitUntil: "domcontentloaded" });
      const sidebar = page.getByRole("navigation", { name: "Documentation sidebar", exact: true });
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole("link")).toHaveText(pages.map((item) => item.title));
      await expect(sidebar.locator('[aria-current="page"]')).toHaveText(entry.title);
      await expect(page.locator("[data-doc-article]")).toHaveAttribute(
        "data-page-type",
        entry.type,
      );
      const pager = page.getByRole("navigation", { name: "Documentation pages", exact: true });
      for (const [direction, neighbor] of [
        ["prev", pages[index - 1]],
        ["next", pages[index + 1]],
      ] as const) {
        const link = pager.locator(`a[rel="${direction}"]`);
        if (!neighbor) await expect(link).toHaveCount(0);
        else {
          await expect(link.locator("strong")).toHaveText(neighbor.title);
          await expect(link).toHaveJSProperty(
            "href",
            `${baseURL}/docs/documentation${neighbor.route}`,
          );
        }
      }
    }
  } finally {
    await context.close();
  }
});

test("native pagers traverse the repaired workflow sequence without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/docs/documentation/guides/file-management/", {
      waitUntil: "domcontentloaded",
    });
    for (const id of ["settings", "dictionaries", "keyboard-shortcuts", "appearance"]) {
      const entry = pages.find((item) => item.id === id)!;
      const next = page
        .getByRole("navigation", { name: "Documentation pages", exact: true })
        .getByRole("link", { name: `Next ${entry.title}`, exact: true });
      await next.press("Enter");
      await expect(page).toHaveURL(`${baseURL}/docs/documentation${entry.route}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (id === "settings") {
        await page
          .getByRole("navigation", { name: "Documentation pages", exact: true })
          .screenshot({ path: test.info().outputPath("settings-static-pager.png") });
      }
    }
  } finally {
    await context.close();
  }
});

test("generated sidebar metadata remains usable by documentation search", async ({ page }) => {
  await page.goto("/docs/documentation/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Search documentation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
  await dialog
    .getByRole("searchbox", { name: "Search documentation pages", exact: true })
    .fill("application-wide preferences");
  const result = dialog.getByRole("link", { name: /Settings/ });
  await expect(result).toHaveCount(1);
  await result.press("Enter");
  await expect(page).toHaveURL(/\/documentation\/guides\/settings\/$/);
});
