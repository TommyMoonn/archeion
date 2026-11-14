import { expect, test } from "@playwright/test";

test("Tailwind utilities and Lucide render in both Docusaurus themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/archeion/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const sample = page.getByRole("region", { name: "Component tooling sample" });
  const button = sample.getByRole("button", { name: "Test component" });
  await expect(button).toBeVisible();

  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await page.setViewportSize({ width: theme === "light" ? 1280 : 390, height: 800 });
    // The inline-flex primitive is blockified because it is itself a flex item.
    await expect(button).toHaveCSS("display", "flex");
    await expect(button).toHaveCSS("gap", "8px");
    await expect(button).toHaveCSS("border-radius", "8px");
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(button.locator("svg")).toHaveCSS("width", "16px");
    await expect(button.locator("svg")).toHaveCSS("height", "16px");
    expect(await button.locator("svg path").count()).toBeGreaterThan(0);
    await expect(button).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(74, 119, 150)" : "rgb(139, 189, 224)",
    );
    await expect(button).toHaveCSS(
      "color",
      theme === "light" ? "rgb(247, 248, 247)" : "rgb(8, 8, 8)",
    );
    await button.hover();
    await expect(button).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(46, 91, 125)" : "rgb(158, 200, 229)",
    );
    await page.mouse.move(0, 0);
    const logos = sample.locator("img");
    await expect(logos.nth(theme === "dark" ? 0 : 1)).toBeVisible();
    await expect(logos.nth(theme === "dark" ? 1 : 0)).toBeHidden();
    expect(
      await logos.evaluateAll((images) =>
        images.every(
          (image) =>
            image instanceof HTMLImageElement && image.complete && image.naturalWidth === 500,
        ),
      ),
    ).toBe(true);
    const tokens = page.getByRole("region", { name: "Design token sample" });
    const panel = tokens.locator("div").first();
    await expect(panel).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(247, 248, 247)" : "rgb(11, 11, 12)",
    );
    await expect(panel).toHaveCSS(
      "border-top-color",
      theme === "light" ? "rgb(221, 222, 221)" : "rgb(38, 38, 39)",
    );
    await expect(panel).toHaveCSS("border-radius", "10px");
    await expect(panel).toHaveCSS("z-index", "60");
    await expect(tokens).toHaveCSS("max-width", "1280px");
    await expect(tokens).toHaveCSS("padding-left", theme === "light" ? "32px" : "24px");
    await expect(tokens.getByText("Raised surface")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(26, 26, 27)",
    );
    await expect(tokens.getByText("Success", { exact: true })).toHaveCSS(
      "color",
      theme === "light" ? "rgb(71, 123, 88)" : "rgb(143, 191, 157)",
    );
    await expect(sample.getByRole("textbox")).toHaveCSS("border-top-style", "solid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});

test("local fonts load and reduced motion disables control transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const missing: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) missing.push(response.url());
  });
  await page.goto("/archeion/");
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Inter"'),
      document.fonts.load('600 16px "Inter"'),
      document.fonts.load('700 16px "Inter"'),
      document.fonts.load('400 16px "Literata"'),
    ]);
  });
  expect(
    await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.status === "loaded")
        .map((face) => `${face.family}:${face.weight}`),
    ),
  ).toEqual(expect.arrayContaining(["Inter:400", "Inter:600", "Inter:700", "Literata:400"]));
  await expect(page.getByRole("button", { name: "Test component" })).toHaveCSS(
    "transition-duration",
    "0s",
  );
  expect(missing).toEqual([]);
});

test("native primitives support keyboard input, activation, focus and slotted navigation", async ({
  page,
}) => {
  await page.goto("/archeion/");
  const input = page.getByRole("textbox", { name: "Sample book title" });
  const button = page.getByRole("button", { name: "Test component" });
  await input.focus();
  await page.keyboard.type("A sample EPUB");
  await expect(input).toHaveValue("A sample EPUB");
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS("outline-style", "solid");
  await expect(button).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Keyboard activation works.");
  await expect(page.getByRole("button", { name: "Unavailable sample" })).toBeDisabled();
  await page.keyboard.press("Tab");
  const link = page.getByRole("link", { name: "Open the component documentation" });
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/archeion\/docs\/foundation$/);
  await expect(
    page.getByRole("heading", { name: "Website foundation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The Archeion website foundation is running.", { exact: true }),
  ).toBeVisible();
});
