import { expect, test } from "@playwright/test";
import { DOMParser } from "@xmldom/xmldom";
import { buildReaderFixture, readerFixtures } from "../fixtures/reader/readerFixtures";
import { validateReaderFixture } from "../fixtures/reader/validateReaderFixture";

for (const fixture of readerFixtures) {
  test(`${fixture.id} loads every spine document in real epub.js iframes`, async ({ page }) => {
    await validateReaderFixture(
      await buildReaderFixture(fixture.id),
      fixture.sections.length,
      (text) =>
        new DOMParser({
          onError(_level, message) {
            throw new Error(message);
          },
        }).parseFromString(text, "application/xml"),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const externalRequests: string[] = [];
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        externalRequests.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`/tests/browser/fixtures/reader-epub.html?fixture=${fixture.id}`);
    await expect.poll(() => page.evaluate(() => window.readerFixture?.ready)).toBe(true);
    expect(
      await page.evaluate(() => ({
        layout: window.readerFixture.layout,
        metadataLayout: window.readerFixture.metadataLayout,
        spineCount: window.readerFixture.spineCount,
      })),
    ).toEqual({
      layout: fixture.layout === "pre-paginated" ? "fixed-layout" : "reflowable",
      metadataLayout: fixture.layout,
      spineCount: fixture.sections.length,
    });
    for (let index = 0; index < fixture.sections.length; index += 1) {
      await page.evaluate((section) => window.readerFixture.display(section), index);
      const content = page.frameLocator("#publication iframe");
      await expect
        .poll(() => content.locator("body").evaluate((element) => element.ownerDocument.title))
        .toBe(fixture.sections[index].id);
      await expect(content.locator("body")).toBeVisible();
      const images = content.locator("img");
      for (let imageIndex = 0; imageIndex < (await images.count()); imageIndex += 1) {
        await expect
          .poll(() =>
            images
              .nth(imageIndex)
              .evaluate(
                (image) =>
                  image instanceof HTMLImageElement &&
                  image.complete &&
                  image.naturalWidth === 420 &&
                  image.naturalHeight === 560,
              ),
          )
          .toBe(true);
      }
    }
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

test("cover shrink leaves a short scroll range after first render without network", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/reader-epub.html?fixture=short-cover&flow=continuous");
  await expect.poll(() => page.evaluate(() => window.readerFixture?.ready)).toBe(true);
  const image = page.frameLocator("#publication iframe").first().locator("#cover-image");
  // The fixture hook controls timing only. It does not compensate scrolling or load neighbors.
  await page.evaluate(() => window.readerFixture.changeImageSize(1317));
  await expect
    .poll(() => image.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(1317);
  await page.evaluate(() => window.readerFixture.changeImageSize());
  await expect
    .poll(() => image.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(933);
  expect(
    await image.evaluate(
      (element) => element.ownerDocument.body.getBoundingClientRect().height - 750,
    ),
  ).toBeLessThan(250);
});

test("previous-section media can grow and shrink after render", async ({ page }) => {
  await page.goto(
    "/tests/browser/fixtures/reader-epub.html?fixture=reverse-prepend&flow=continuous",
  );
  await expect.poll(() => page.evaluate(() => window.readerFixture?.ready)).toBe(true);
  const image = page.frameLocator("#publication iframe").first().locator("#previous-tall-image");
  await page.evaluate(() => window.readerFixture.changeImageSize());
  await expect
    .poll(() => image.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(2100);
  await page.evaluate(() => window.readerFixture.changeImageSize(1600));
  await expect
    .poll(() => image.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(1600);
});

test("fixed-layout keeps composed geometry and its page link", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/reader-epub.html?fixture=fixed-layout");
  await expect.poll(() => page.evaluate(() => window.readerFixture?.ready)).toBe(true);
  const content = page.frameLocator("#publication iframe");
  await expect(content.locator(".page-label")).toHaveCSS("position", "absolute");
  await expect(content.locator(".page-label")).toHaveCSS("left", "370px");
  await content.getByRole("link", { name: "Continue to page two" }).click();
  await expect(content.locator("#page-two-anchor")).toBeVisible();
});
