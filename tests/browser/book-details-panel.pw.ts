import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/fixtures/ui-stability.html?count=2";
const panelSelector = ".book-details-panel";

async function openPinned(page: Page, appearance = "dark") {
  await page.goto(`${fixture}&theme=${appearance}`);
  await page.locator(".book-card__select").first().click();
  await expect(page.locator("dialog.details-drawer")).toBeVisible();
  await expect(page.locator("dialog.details-drawer .details-drawer__header")).toContainText(
    "Book details",
  );
  await page.getByRole("button", { name: "Pin book details", exact: true }).click();
  await expect(page.locator(panelSelector)).toBeVisible();
  await expect(page.locator("dialog.details-drawer")).toHaveCount(0);
  await expect(page.locator(`${panelSelector} .details-drawer__header`)).toHaveCount(0);
}

for (const appearance of ["dark", "light", "custom"]) {
  test(`last-read preview fits the minimum panel width in ${appearance} appearance`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}&theme=${appearance}&covers=artwork`);
    await expect(page.locator(".book-card__select").first()).toBeVisible();
    await page.evaluate(() => window.uiStabilityFixture.suggestLastRead());
    const panel = page.locator(panelSelector);
    await expect(panel.getByText("Last read", { exact: true })).toBeVisible();
    await expect(panel.getByText("42% read", { exact: true })).toBeVisible();
    await expect(page.locator(".continue-reading")).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "Also in progress" })).toBeVisible();
    await expect(panel.locator(".continue-book")).toHaveCount(1);
    const lastOpened = panel.locator(".book-details-panel__last-opened");
    await expect(lastOpened).toContainText("Last opened");
    await expect(lastOpened).toHaveCSS("border-top-width", "0px");
    await expect(lastOpened).toHaveCSS("border-bottom-width", "0px");
    await expect(page.locator('[data-inspected="true"], [data-selected]')).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Favorite book", exact: true })).toBeDisabled();
    const handle = panel.getByRole("separator", { name: "Resize book details" });
    await handle.focus();
    await page.keyboard.press("Home");
    await expect(panel).toHaveCSS("width", "280px");
    await page.evaluate(() => (document.documentElement.style.fontSize = "150%"));
    // Keep the viewport above the rem-based docking threshold with enlarged text.
    await page.setViewportSize({ width: 1920, height: 900 });
    const resume = panel.getByRole("button", { name: "Continue reading", exact: true });
    await resume.focus();
    await expect(resume).toBeFocused();
    await expect(resume).toBeInViewport();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath(`last-read-${appearance}.png`) });
    const suggestionCover = await panel.locator(".details-cover").boundingBox();
    await panel.getByRole("button", { name: "View book details", exact: true }).click();
    await expect(panel.getByText("Last read", { exact: true })).toHaveCount(0);
    const inspectedCover = await panel.locator(".details-cover").boundingBox();
    expect(suggestionCover).not.toBeNull();
    expect(inspectedCover).toEqual(suggestionCover);
    await resume.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  });

  test(`another in-progress book resumes from the panel in ${appearance} appearance`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${fixture}&theme=${appearance}`);
    await expect(page.locator(".book-card__select").first()).toBeVisible();
    await page.evaluate(() => window.uiStabilityFixture.suggestLastRead());
    const row = page.locator(`${panelSelector} .continue-book`);
    const bookId = await row.getAttribute("data-reader-book-id");
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/reader/${encodeURIComponent(bookId ?? "")}$`));
    await expect(page.locator(".epub-container iframe").first()).toBeVisible();
    await page.getByRole("button", { name: /Back to Library/ }).click();
    const panel = page.locator(panelSelector);
    await expect(panel.getByText("Last read", { exact: true })).toBeVisible();
    await expect(panel.locator("h2")).toHaveText("Book 0001");
    await expect(page.locator(".continue-reading")).toHaveCount(0);
  });

  test(`pinned details keep the collection usable in ${appearance} appearance`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPinned(page, appearance);
    const panel = page.locator(panelSelector);
    const firstBook = page.locator(".book-card__select").first();
    const secondBook = page.locator(".book-card__select").nth(1);
    await expect(firstBook).toBeFocused();
    const bounds = await page.evaluate(() => {
      const main = document.querySelector(".page-shell")!.getBoundingClientRect();
      const panel = document.querySelector(".book-details-panel")!.getBoundingClientRect();
      return {
        mainRight: main.right,
        panelLeft: panel.left,
        panelRight: panel.right,
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(bounds.mainRight).toBe(bounds.panelLeft);
    const scrollbar = await page.locator(".page-shell").evaluate((element) => {
      const thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb");
      return {
        width: getComputedStyle(element, "::-webkit-scrollbar").width,
        border: thumb.borderInlineEndWidth,
        radius: Number.parseFloat(thumb.borderStartEndRadius),
      };
    });
    expect(scrollbar.width).toBe("6px");
    expect(scrollbar.border).toBe("0px");
    expect(scrollbar.radius).toBeGreaterThan(0);
    expect(bounds.panelRight).toBe(bounds.width);
    expect(bounds.overflow).toBe(false);
    expect(
      await page
        .locator(".page-shell")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(page.getByRole("button", { name: "Add EPUB", exact: true })).toBeInViewport();
    await secondBook.click();
    await expect(secondBook).toHaveAttribute("aria-pressed", "true");
    await expect(firstBook).toHaveAttribute("aria-pressed", "false");
    await expect(panel.locator("h2")).toHaveText(await secondBook.locator("strong").innerText());
    await expect(secondBook).toBeFocused();
    const surfaces = await page.evaluate(() => {
      const main = getComputedStyle(document.querySelector(".page-shell")!);
      const details = getComputedStyle(document.querySelector(".book-details-panel")!);
      return {
        main: main.backgroundColor,
        panel: details.backgroundColor,
        border: details.borderInlineStartWidth,
        shadow: details.boxShadow,
      };
    });
    expect(surfaces.panel).toBe(surfaces.main);
    expect(surfaces.border).toBe("1px");
    expect(surfaces.shadow).toBe("none");
    await page.screenshot({ path: test.info().outputPath(`pinned-details-${appearance}.png`) });
    await expect(
      panel.getByRole("button", { name: "Close book details", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Unpin book details", exact: true }).click();
    await page
      .locator("dialog.details-drawer")
      .getByRole("button", { name: "Close book details", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(secondBook).toBeFocused();
    await secondBook.click();
    await expect(page.locator("dialog.details-drawer")).toBeVisible();
  });
}

test("narrow windows use the slide-over and preserve the pin choice on widening", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  const title = await page.locator(`${panelSelector} h2`).innerText();
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(page.locator(panelSelector)).toHaveCount(0);
  await expect(page.locator("dialog.details-drawer")).toBeVisible();
  await expect(page.locator("dialog.details-drawer h2")).toHaveText(title);
  await expect(page.locator("dialog.details-drawer .details-drawer__header")).toBeVisible();
  await expect(
    page.locator("dialog.details-drawer").getByRole("button", { name: "Start from beginning" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(panelSelector)).toBeVisible();
  await expect(page.locator("dialog.details-drawer")).toHaveCount(0);
  await expect(page.locator(`${panelSelector} h2`)).toHaveText(title);
});

test("pin and resized width survive reload, Reader navigation, and archive switches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  const panel = page.locator(panelSelector);
  const handle = panel.getByRole("separator", { name: "Resize book details" });
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "344");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "368");
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem("ui-stability-book-details") ?? "{}").detailsWidth,
      ),
    )
    .toBe(368);
  // Restore the instrumented entry URL before reloading the real routed app.
  await page.evaluate((url) => history.replaceState(history.state, "", url), fixture);
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading")).toHaveText("Book details");
  await expect(handle).toHaveAttribute("aria-valuenow", "368");
  await expect(panel).toHaveCSS("width", "368px");
  await page.locator(".book-card__select").first().click();
  await panel.getByRole("button", { name: "Read book", exact: true }).click();
  await expect(page.locator(".epub-container iframe").first()).toBeVisible();
  await page.getByRole("button", { name: /Back to Library/ }).click();
  await expect(panel).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", "368");
  await page.evaluate(() => window.uiStabilityFixture.switchArchive("b"));
  await expect.poll(() => page.evaluate(() => window.uiStabilityState?.().archive)).toBe("b");
  await expect(panel).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", "368");
  await expect(panel.getByRole("heading")).toHaveText("Book details");
});

test("pointer resizing and width limits work in the pinned panel and slide-over", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  const handle = page.getByRole("separator", { name: "Resize book details" });
  const rect = await handle.boundingBox();
  if (!rect) throw new Error("Book details resize handle is missing");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 100);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 - 64, rect.y + 100);
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "280");
  const labelsFit = await page.locator(panelSelector).evaluate((panel) =>
    Array.from(panel.querySelectorAll(".details-actions__secondary .button")).every((button) => {
      const label = button.querySelector(".button__label");
      if (!label) return false;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      return text.left >= bounds.left && text.right <= bounds.right;
    }),
  );
  expect(labelsFit).toBe(true);
  expect(
    await page
      .locator(panelSelector)
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.keyboard.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "480");
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole("separator", { name: "Resize sidebar", exact: true }).focus();
  await page.keyboard.press("End");
  expect(
    await page
      .locator(".page-shell")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Add EPUB", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Unpin book details" }).click();
  const drawer = page.locator("dialog.details-drawer");
  await expect(drawer).toHaveCSS("width", "480px");
  await drawer.getByRole("separator", { name: "Resize book details" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "472");
  await expect(drawer).toHaveCSS("width", "472px");
  const shadow = await drawer.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(shadow).toBe("none");
});

test("removed books show a stable empty panel and its controls stay keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  const panel = page.locator(panelSelector);
  const before = await panel.boundingBox();
  const unpin = panel.getByRole("button", { name: "Unpin book details", exact: true });
  const unpinBefore = await unpin.boundingBox();
  await page.evaluate(() => window.uiStabilityFixture.resizeCatalog(0));
  await expect(panel.getByRole("heading", { name: "Book details" })).toBeVisible();
  expect(await unpin.boundingBox()).toEqual(unpinBefore);
  await expect(panel).toContainText("Book details appear here after you add and select a book.");
  expect(await panel.boundingBox()).toEqual(before);
  await panel.getByRole("button", { name: "Unpin book details" }).focus();
  await expect(panel.getByRole("button", { name: "Close book details" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(panel).toHaveCount(0);
});

test("bulk selection shows a summary and clearing it shows the selection prompt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  await page
    .locator(".book-card__select")
    .first()
    .click({ modifiers: ["Control"] });
  await page.locator(".book-card__select").nth(1).click();
  const panel = page.locator(panelSelector);
  await expect(panel.getByRole("heading")).toHaveText("2 books selected");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(panel.getByRole("heading")).toHaveText("Book details");
});

test("unpinning restores a modal drawer and nested editors return focus to the pinned action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPinned(page);
  const edit = page
    .locator(panelSelector)
    .getByRole("button", { name: "Edit metadata", exact: true });
  await edit.click();
  await expect(page.locator(".dialog--metadata-writeback")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog--metadata-writeback")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await page.getByRole("button", { name: "Unpin book details", exact: true }).click();
  await expect(page.locator(panelSelector)).toHaveCount(0);
  await expect(page.locator("dialog.details-drawer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close book details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.details-drawer")).toHaveCount(0);
  await expect(page.locator(".book-card__select").first()).toBeFocused();
});

test("list inspection supports keyboard activation, enlarged text, and forced colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(`${fixture}&view=list&theme=light`);
  const first = page.locator(".book-row__select").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Pin book details", exact: true }).click();
  const panel = page.locator(panelSelector);
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  const second = page.locator(".book-row__select").nth(1);
  await second.focus();
  await page.keyboard.press("Space");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator("h2")).toHaveText(await second.locator("strong").innerText());
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(panel.getByRole("button", { name: "Unpin book details" })).toBeInViewport();
});
