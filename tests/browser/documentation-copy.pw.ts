import { expect, test } from "@playwright/test";

test("keyboard copy writes article Markdown and code through the shared status", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/documentation/customization/custom-themes/", { waitUntil: "load" });
  const copy = page.getByRole("button", { name: "Copy page", exact: true });
  const status = page.locator("[data-doc-copy-status]");
  await expect(status).toBeEmpty();
  await copy.focus();
  await copy.press("Enter");
  await expect(status).toHaveText("Page copied as Markdown.");
  await expect(copy).toBeFocused();
  await expect(copy).toHaveAccessibleName("Copy page");
  // Windows native text clipboards normalize line endings to CRLF.
  const markdown = (await page.evaluate(() => navigator.clipboard.readText())).replace(
    /\r\n/g,
    "\n",
  );
  expect(markdown).toMatch(/^# Custom themes\n/);
  expect(markdown).toContain("```json\n");
  expect(markdown).toContain("| Field | Required | Value |");
  expect(markdown).not.toMatch(
    /Copy page|Copy code|On this page|Edit this page|Report a documentation issue/,
  );
  expect(markdown).toContain(
    "[Open the theme schema](<http://127.0.0.1:4173/docs/schemas/archeion-theme-v1.schema.json>)",
  );
  const code = page.locator("pre code").first();
  const codeButton = page.getByRole("button", { name: "Copy code", exact: true }).first();
  await codeButton.focus();
  await codeButton.press("Space");
  await expect(status).toHaveText("Code copied.");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    await code.textContent(),
  );
  await expect(codeButton).toBeFocused();
  await expect(codeButton).toHaveAccessibleName("Copy code");
  await expect(page.locator("[data-doc-copy-status]")).toHaveCount(1);
  const dismiss = page.getByRole("button", { name: "Dismiss copy status" });
  await dismiss.focus();
  await dismiss.press("Enter");
  await expect(status).toBeEmpty();
  await expect(codeButton).toBeFocused();
});

test("clipboard denial preserves action identity and focus, then retry succeeds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let deny = true;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          if (deny) {
            deny = false;
            throw new Error("Clipboard denied");
          }
        },
      },
    });
  });
  await page.goto("/docs/documentation/", { waitUntil: "load" });
  const copy = page.getByRole("button", { name: "Copy page", exact: true });
  await copy.focus();
  await copy.press("Enter");
  const status = page.locator("[data-doc-copy-status]");
  await expect(status).toHaveText("Unable to copy page. Allow clipboard access and try again.");
  await expect(copy).toHaveAccessibleName("Copy page");
  await expect(copy).toBeFocused();
  await page.screenshot({ path: test.info().outputPath("copy-failure.png") });
  await copy.press("Space");
  await expect(status).toHaveText("Page copied as Markdown.");
  await expect(copy).toBeFocused();
});

for (const appearance of ["light", "dark"] as const) {
  for (const width of [320, 1280]) {
    test(`copy action and feedback reflow in ${appearance} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: appearance, reducedMotion: "reduce" });
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async () => {} },
        }),
      );
      await page.goto("/docs/documentation/reference/about-resources/", {
        waitUntil: "load",
      });
      const copy = page.getByRole("button", { name: "Copy page", exact: true });
      await copy.focus();
      await copy.press("Enter");
      await expect(page.locator("[data-doc-copy-status]")).toHaveText("Page copied as Markdown.");
      const target = await copy.boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(40);
      expect(target!.height).toBeGreaterThanOrEqual(40);
      expect(target!.x + target!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(copy).toHaveCSS("outline-style", "solid");
      await test.info().attach("copy-colors", {
        contentType: "application/json",
        body: JSON.stringify(
          await page.evaluate(() =>
            [".copy-page-button", ".doc-copy-feedback"].map((selector) => {
              const style = getComputedStyle(document.querySelector(selector)!);
              const canvas = getComputedStyle(document.documentElement);
              return {
                selector,
                foreground: style.color,
                background: style.backgroundColor,
                focus: style.outlineColor,
                adjacent: canvas.backgroundColor,
              };
            }),
          ),
        ),
      });
      await page.screenshot({ path: test.info().outputPath("copy-success.png") });
      // Text resizing must wrap the title/action instead of clipping either.
      const originalTitleSize = await page
        .locator(".article-header h1")
        .evaluate((title) => parseFloat(getComputedStyle(title).fontSize));
      await page.evaluate(() => {
        const elements = [
          ...document.querySelectorAll<HTMLElement>(
            ".doc-article, .doc-article h1, .doc-article h2, .doc-article h3, .doc-article p, .doc-article li, .copy-page-button, .doc-copy-status",
          ),
        ];
        const sizes = elements.map((element) => parseFloat(getComputedStyle(element).fontSize));
        elements.forEach((element, index) => {
          element.style.fontSize = `${sizes[index] * 2}px`;
        });
      });
      await expect(copy).toHaveCSS("font-size", "28px");
      await expect(page.locator(".article-header h1")).toHaveCSS(
        "font-size",
        `${originalTitleSize * 2}px`,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(copy).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("copy-200-percent-text.png") });
    });
  }
}

test("touch targets and forced-colors focus remain visible", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 900 },
    forcedColors: "active",
  });
  try {
    const page = await context.newPage();
    await page.goto("/docs/documentation/customization/custom-themes/", {
      waitUntil: "load",
    });
    const copy = page.getByRole("button", { name: "Copy page", exact: true });
    await page.keyboard.press("Tab");
    await copy.focus();
    await expect(copy).toHaveCSS("outline-style", "solid");
    await expect(copy).toHaveCSS("outline-width", "2px");
    for (const button of [
      copy,
      page.getByRole("button", { name: "Copy code", exact: true }).first(),
    ]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath("copy-touch-forced-colors.png") });
  } finally {
    await context.close();
  }
});

test.describe("copy is a progressive enhancement", () => {
  test.use({ javaScriptEnabled: false });
  test("does not expose unavailable copy controls without JavaScript", async ({ page }) => {
    await page.goto("/docs/documentation/customization/custom-themes/", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy (page|code)/ })).toHaveCount(0);
  });
});
