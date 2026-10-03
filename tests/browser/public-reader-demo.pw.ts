import { expect, test, type Page } from "@playwright/test";

const passageQuote = "Nothing was lost. It had only been waiting for an index.";
const copyFailure = "Unable to copy setup commands. Select the commands and copy them manually.";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function mockClipboard(page: Page, outcomes: ("success" | "failure")[]) {
  await page.addInitScript((results) => {
    let calls = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.clipboardArgument = text;
          document.documentElement.dataset.clipboardCalls = String(++calls);
          if (results[calls - 1] === "failure")
            throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    });
  }, outcomes);
}

test("passage identity survives highlight, note, and removal actions", async ({ page }) => {
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  const passage = page.getByRole("button", { name: passageQuote, exact: true });
  await expect(passage).toHaveAccessibleDescription(
    "Select to highlight this passage or add a note.",
  );
  await passage.press("Enter");
  const palette = page.getByRole("group", { name: "Highlight passage", exact: true });
  await expect(
    palette.getByRole("button", { name: "Yellow highlight", exact: true }),
  ).toBeFocused();
  await palette.getByRole("button", { name: "Green highlight", exact: true }).press("Space");
  await expect(passage).toBeFocused();
  await expect(passage).toHaveAccessibleName(passageQuote);
  await expect(passage).toHaveAccessibleDescription(
    "Green highlight. Select to change the highlight or add a note.",
  );
  await passage.press("Space");
  await palette.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByRole("textbox", { name: "Note text", exact: true }).fill("Fixture note");
  await expect(passage).toHaveAccessibleName(passageQuote);
  await expect(passage).toHaveAccessibleDescription(
    "Green highlight with note. Select to change the highlight or edit the note.",
  );
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(passage).toHaveAccessibleDescription(
    "Green highlight. Select to change the highlight or add a note.",
  );
  await passage.press("Enter");
  await palette.getByRole("button", { name: "Remove highlight", exact: true }).click();
  await expect(passage).toHaveAccessibleName(passageQuote);
  await expect(passage).toHaveAccessibleDescription(
    "Select to highlight this passage or add a note.",
  );
});

test("each Reader page exposes its passage text rather than an action label", async ({ page }) => {
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  const article = page.locator("[data-reader-page-copy]");
  for (const [variant, quote] of [
    ["opener", "The oldest receiver on Meridian Station had been silent for nineteen years."],
    ["prose", passageQuote],
    ["transcript", "AWAITING READER"],
    ["index", "An archive does not predict the future. It remembers what has not happened yet."],
  ]) {
    await expect(article).toHaveAttribute("data-reader-page-variant", variant);
    await expect(
      article.getByRole("button", { name: quote, exact: true }),
    ).toHaveAccessibleDescription("Select to highlight this passage or add a note.");
    await expect(page.locator("[data-reader-passage-description]")).toHaveCount(1);
    if (variant !== "index")
      await page.getByRole("button", { name: "Next page", exact: true }).click();
  }
});

test("bookmark has a stable name and exposes its per-page toggle state", async ({ page }) => {
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  const bookmark = page.getByRole("button", { name: "Bookmark", exact: true });
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.focus();
  for (const pressed of [true, false]) {
    await bookmark.press("Space");
    await expect(bookmark).toHaveAttribute("aria-pressed", String(pressed));
    await expect(bookmark).toBeFocused();
  }
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
});

test("theme radios expose one selection with arrow, Home, End, and Tab behavior", async ({
  page,
}) => {
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  const group = page.getByRole("radiogroup", { name: "Reader theme", exact: true });
  await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
  await group.getByRole("radio", { name: "Dark theme", exact: true }).focus();
  for (const [key, theme] of [
    ["ArrowRight", "Sepia"],
    ["ArrowDown", "Light"],
    ["ArrowRight", "Dark"],
    ["ArrowLeft", "Light"],
    ["Home", "Dark"],
    ["End", "Light"],
    ["ArrowUp", "Sepia"],
  ]) {
    await page.keyboard.press(key);
    const radio = group.getByRole("radio", { name: `${theme} theme`, exact: true, checked: true });
    await expect(radio).toBeFocused();
    await expect(group.getByRole("radio", { checked: true })).toHaveCount(1);
    await expect(page.locator("[data-reader-demo]")).toHaveAttribute(
      "data-theme",
      theme.toLowerCase(),
    );
  }
  await page.keyboard.press("Space");
  await expect(group.getByRole("radio", { name: "Sepia theme", checked: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("slider", { name: "Reader type size", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(group.getByRole("radio", { name: "Sepia theme", checked: true })).toBeFocused();
  await group.getByRole("radio", { name: "Light theme", exact: true }).click();
  await expect(group.getByRole("radio", { name: "Light theme", checked: true })).toBeFocused();
});

for (const outcome of ["success", "failure"] as const) {
  test(`copy ${outcome} updates a persistent polite status without moving focus`, async ({
    page,
  }) => {
    await mockClipboard(page, [outcome]);
    await page.goto("/docs/", { waitUntil: "domcontentloaded" });
    const copy = page.getByRole("button", { name: "Copy setup commands", exact: true });
    const status = page.locator("[data-copy-status]");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toBeEmpty();
    await copy.press("Space");
    await expect(status).toHaveText(outcome === "success" ? "Setup commands copied." : copyFailure);
    await expect(copy).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-clipboard-calls", "1");
  });
}

test("copy retry clears earlier visual reset timers and preserves failure feedback", async ({
  page,
}) => {
  await page.clock.install();
  await mockClipboard(page, ["success", "failure"]);
  await page.goto("/docs/", { waitUntil: "domcontentloaded" });
  const copy = page.getByRole("button", { name: "Copy setup commands", exact: true });
  const status = page.locator("[data-copy-status]");
  await copy.press("Space");
  await expect(status).toHaveText("Setup commands copied.");
  await copy.press("Space");
  await expect(status).toHaveText(copyFailure);
  await page.clock.runFor(2000);
  await expect(copy.locator("span")).toHaveText("Select text");
  await expect(status).toHaveText(copyFailure);
  await expect(copy).toBeFocused();
});

for (const outcome of ["success", "denied", "throws"] as const) {
  test(`legacy clipboard ${outcome} announces its result and releases the temporary control`, async ({
    page,
  }) => {
    await page.addInitScript((result) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => {
          if (result === "throws") throw new Error("Clipboard unavailable");
          return result === "success";
        },
      });
    }, outcome);
    await page.goto("/docs/", { waitUntil: "domcontentloaded" });
    const copy = page.getByRole("button", { name: "Copy setup commands", exact: true });
    await copy.press("Space");
    await expect(page.locator("[data-copy-status]")).toHaveText(
      outcome === "success" ? "Setup commands copied." : copyFailure,
    );
    await expect(copy).toBeFocused();
    await expect(page.locator("textarea[readonly]")).toHaveCount(0);
  });
}

for (const theme of ["dark", "light"]) {
  test(`Reader semantic updates preserve the ${theme} appearance`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/docs/", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("radio", { name: `${theme === "dark" ? "Dark" : "Light"} theme`, exact: true })
      .click();
    await page.getByRole("button", { name: "Bookmark", exact: true }).click();
    await expect(page.getByRole("button", { name: passageQuote, exact: true })).toBeVisible();
    await page
      .locator("[data-reader-demo]")
      .screenshot({ path: test.info().outputPath(`public-reader-${theme}.png`) });
  });
}
