import { expect, test } from "@playwright/test";

test("Tailwind utilities and Lucide render in both Docusaurus themes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/archeion/");
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
    await expect(button).toHaveCSS("border-radius", "6px");
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(button.locator("svg")).toHaveCSS("width", "16px");
    await expect(button.locator("svg")).toHaveCSS("height", "16px");
    expect(await button.locator("svg path").count()).toBeGreaterThan(0);
    const colors = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        expected: style.getPropertyValue("--ifm-color-primary").trim(),
      };
    });
    // Resolve the theme token through a browser color property for a format-independent comparison.
    const expected = await page.evaluate((color) => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.append(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    }, colors.expected);
    await expect(button).toHaveCSS("background-color", expected);
    await expect(sample.getByRole("textbox")).toHaveCSS("border-top-style", "solid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
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
