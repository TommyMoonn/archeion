import { expect, test } from "@playwright/test";
import { documents, sidebarGroups } from "../documentationMdxTestSupport";

const ordered = sidebarGroups().flatMap((group) => group.items);

test("all 24 MDX articles publish coherent metadata, native navigation, outlines and footer actions", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const networkFailures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) networkFailures.push(response.url());
  });
  const staticContext =
    process.env.ARCHEION_WEBSITE_MODE === "dev"
      ? null
      : await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await staticContext?.newPage();
    for (const [index, id] of ordered.entries()) {
      const doc = documents.find((item) => item.metadata.id === id);
      if (!doc) throw new Error(`Missing document ${id}`);
      const url = `/archeion/docs${doc.metadata.slug}`;
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(doc.metadata.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        doc.metadata.description,
      );
      await expect(page).toHaveTitle(`${doc.metadata.title} | Archeion`);
      const canonical = `https://tommymoonn.github.io${url}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
        "content",
        doc.metadata.description,
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        "https://tommymoonn.github.io/archeion/assets/archeion-preview.png",
      );
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary_large_image",
      );
      await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
        "href",
        "/archeion/assets/images/archeion-icon.png",
      );
      await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
        "href",
        "/archeion/assets/archeion-icon.png",
      );
      await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(doc.metadata.title);
      const sidebar = page.getByRole("complementary", { name: "Documentation navigation" });
      await expect(sidebar.locator("a")).toHaveCount(24);
      await expect(sidebar.locator('a[aria-current="page"]')).toHaveText(
        doc.metadata.sidebar_label,
      );
      const pager = page.getByRole("navigation", { name: "Documentation pages" });
      await expect(pager.getByRole("link")).toHaveCount(index === 0 || index === 23 ? 1 : 2);
      for (const [offset, label] of [
        [-1, "Previous"],
        [1, "Next"],
      ] as const) {
        const neighborId = ordered[index + offset];
        if (!neighborId) continue;
        const neighbor = documents.find((item) => item.metadata.id === neighborId);
        if (!neighbor) throw new Error(`Missing neighbor ${neighborId}`);
        await expect(
          pager.getByRole("link", { name: `${label} ${neighbor.metadata.sidebar_label}` }),
        ).toHaveAttribute("href", `/archeion/docs${neighbor.metadata.slug}`);
      }
      await expect(page.getByRole("link", { name: "Edit this page", exact: true })).toHaveAttribute(
        "href",
        doc.metadata.custom_edit_url ??
          `https://github.com/TommyMoonn/archeion/edit/main/website/docs/${id}.mdx`,
      );
      await expect(
        page.getByRole("link", { name: "Report a documentation issue" }),
      ).toHaveAttribute("href", "https://github.com/TommyMoonn/archeion/issues");
      const headings = [...doc.body.matchAll(/^(#{2,3}) (.+) \{#([\w-]+)\}$/gm)];
      const toc = page.getByRole("navigation", { name: "Table of contents" });
      await expect(toc.getByRole("link")).toHaveCount(headings.length);
      for (const [, , , fragment] of headings) {
        await expect(page.locator(`article #${fragment}`)).toHaveCount(1);
        await expect(toc.locator(`a[href="#${fragment}"]`)).toHaveCount(1);
        await expect(
          page.locator(`article #${fragment} a[href="#${fragment}"]`),
        ).toHaveAccessibleName(/Link to /);
      }
      for (const [, fragment] of doc.body.matchAll(/id="([\w-]+)"/g))
        await expect(page.locator(`article #${fragment}`)).toHaveCount(1);
      if (staticPage) {
        await staticPage.goto(new URL(url, page.url()).href);
        await expect(staticPage.getByRole("heading", { level: 1 })).toHaveText(doc.metadata.title);
        await expect(staticPage.getByRole("main").locator("article")).toContainText(
          doc.metadata.description,
        );
        await expect(
          staticPage.getByRole("navigation", { name: "Documentation pages" }).getByRole("link"),
        ).toHaveCount(index === 0 || index === 23 ? 1 : 2);
      }
    }
  } finally {
    await staticContext?.close();
  }
  expect(networkFailures).toEqual([]);
});
