import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html";

for (const view of ["grid", "list"] as const) {
  test(`${view} retains a matching card and cover resource`, async ({ page }) => {
    await page.addInitScript(() => {
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        document.documentElement.dataset.revokedCoverUrls = `${document.documentElement.dataset.revokedCoverUrls ?? ""}\n${url}`;
        revoke(url);
      };
    });
    await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".book-grid")).toBeVisible();
    await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
    const card = page.locator("[data-reader-book-id]").first();
    const image = card.locator("img");
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(120);
    const identity = await card.elementHandle();
    const url = await image.getAttribute("src");
    await page.getByRole("searchbox", { name: "Search library" }).fill("Book-0000");
    await expect(page.locator("[data-window-total]")).toHaveAttribute("data-window-total", "1");
    expect(
      await identity!.evaluate((node) => node === document.querySelector("[data-reader-book-id]")),
    ).toBe(true);
    expect(await image.getAttribute("src")).toBe(url);
    await page.getByRole("button", { name: "Select books", exact: true }).click();
    expect(await identity!.evaluate((node) => node.isConnected)).toBe(true);
    expect(
      (await page.locator("html").getAttribute("data-revoked-cover-urls")) ?? "",
    ).not.toContain(url);
  });
}

test("archive, view and Reader handoffs retire ownership with one entrance", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "app-motion-view-content-in" &&
        (event.target as Element).classList.contains("library-content--books")
      ) {
        document.documentElement.dataset.collectionEntrances = String(
          Number(document.documentElement.dataset.collectionEntrances ?? 0) + 1,
        );
      }
    });
  });
  await page.goto(`${fixture}?count=2`, { waitUntil: "domcontentloaded" });
  const root = page.locator(".library-content--books");
  await expect(root).toHaveAttribute("data-surface-state", "results");
  await expect(page.locator("html")).toHaveAttribute("data-collection-entrances", "1");
  const oldRoot = await root.elementHandle();
  const oldBook = await page.locator("[data-reader-book-id]").first().elementHandle();
  await page.evaluate(() => window.uiStabilityFixture.switchArchive("b"));
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().archive)).toBe("b");
  await expect(root).toHaveAttribute("data-surface-state", "results");
  expect(await oldRoot!.evaluate((node) => node.isConnected)).toBe(false);
  expect(await oldBook!.evaluate((node) => node.isConnected)).toBe(false);
  await expect(page.locator("html")).toHaveAttribute("data-collection-entrances", "2");
  await page.evaluate(() => window.uiStabilityFixture.setView("list"));
  await expect(page.locator(".book-list")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-collection-entrances", "3");
  await page.locator(".book-row__select").first().click();
  await page.getByRole("button", { name: "Read book", exact: true }).click();
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect(page.locator(".book-list")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-collection-entrances", "4");
});

for (const view of ["grid", "list"] as const) {
  for (const height of [560, 960]) {
    for (const textScale of [1, 1.25]) {
      test(`${view} collection ownership at ${height}px and ${textScale} text`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width: 1100, height });
        await page.goto(`${fixture}?count=50`, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".book-grid")).toBeVisible();
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${16 * scale}px`;
        }, textScale);
        await page.evaluate((view) => window.uiStabilityFixture.setView(view), view);
        const root = page.locator(".library-content--books");
        await expect(root).toHaveAttribute("data-surface-state", "results");
        // Wait for the deliberate entrance to settle before measuring geometry.
        await root.evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished));
        });
        const observation = await root.evaluateHandle((node) => {
          const events: string[] = [];
          document.addEventListener("animationstart", (event) => {
            if (event.animationName === "app-motion-view-content-in")
              events.push(event.animationName);
          });
          return { node, items: node.querySelector(".collection-content__items"), events };
        });
        const measure = () =>
          page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".library-content--books")!;
            return {
              top: root.getBoundingClientRect().top,
              padding: getComputedStyle(root).paddingTop,
              toolbar: document.querySelector(".library-header")!.getBoundingClientRect().top,
              sidebar: document.querySelector(".sidebar")!.getBoundingClientRect().top,
              scroll: document.querySelector(".page-shell")!.scrollTop,
            };
          });
        const baseline = await measure();
        const search = page.getByRole("searchbox", { name: "Search library" });
        for (const query of ["no-such-synthetic-book", "", "another-missing-title", ""]) {
          await search.fill(query);
          await expect(root).toHaveAttribute(
            "data-surface-state",
            query ? "search-empty" : "results",
          );
          expect(
            await observation.evaluate(({ node, items }) => ({
              root: node === document.querySelector(".library-content--books"),
              items: items === node.querySelector(".collection-content__items"),
            })),
          ).toEqual({ root: true, items: true });
          expect(await measure()).toEqual(baseline);
        }
        await page.getByRole("button", { name: "Select books", exact: true }).click();
        await page.getByRole("button", { name: "Select books", exact: true }).click();
        await page.evaluate(() => window.uiStabilityFixture.resizeCatalog(0));
        await expect(root).toHaveAttribute("data-surface-state", "empty");
        expect(await measure()).toEqual(baseline);
        await page.evaluate(() => window.uiStabilityFixture.resizeCatalog(50));
        await expect(root).toHaveAttribute("data-surface-state", "results");
        expect(
          await observation.evaluate(({ node, items, events }) => ({
            root: node === document.querySelector(".library-content--books"),
            items: items === node.querySelector(".collection-content__items"),
            entrances: events.length,
          })),
        ).toEqual({ root: true, items: true, entrances: 0 });
        await info.attach("collection-geometry", {
          body: JSON.stringify({ view, height, textScale, baseline, final: await measure() }),
          contentType: "application/json",
        });
        await page.locator(".page-shell").evaluate((node) => {
          node.scrollTop = node.scrollHeight / 2;
        });
        await expect
          .poll(() => page.locator("[data-window-start]").getAttribute("data-window-start"))
          .not.toBe("0");
        expect(
          await observation.evaluate(({ node, events }) => ({
            connected: node.isConnected,
            entrances: events.length,
          })),
        ).toEqual({ connected: true, entrances: 0 });
      });
    }
  }
}
