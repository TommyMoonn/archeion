import { expect, test } from "@playwright/test";

for (const [placement, opposite] of [
  ["top", "bottom"],
  ["bottom", "top"],
  ["left", "right"],
  ["right", "left"],
] as const) {
  test(`tooltip flips ${placement} and remains within the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/fixtures/?view=tooltip&placement=${placement}`);
    await page.getByRole("button", { name: "Edge tooltip" }).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("data-side", opposite);
    await expect(tooltip).toHaveCSS("pointer-events", "none");
    await expect(tooltip).toHaveCSS("animation-name", "none");
    await expect
      .poll(async () =>
        tooltip.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return (
            rect.left >= 7 &&
            rect.top >= 7 &&
            rect.right <= innerWidth - 7 &&
            rect.bottom <= innerHeight - 7 &&
            node.scrollWidth <= node.clientWidth
          );
        }),
      )
      .toBe(true);
    // Containment alone also passes when a tooltip collapses into a narrow column.
    await expect
      .poll(() => tooltip.evaluate((node) => node.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(240);
    await expect(page.locator(".reader-page").getByRole("tooltip")).toBeVisible();
    await page.setViewportSize({ width: 360, height: 480 });
    await expect(tooltip).toHaveCount(0);
  });
}

test("tooltip handles truncation, disabled explanations and modality", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=tooltip");
  const tooltip = page.getByRole("tooltip");
  const short = page.getByRole("button", { name: "Short label" });
  // A controlled clock proves the full delay elapsed without a tooltip for untruncated text.
  await page.clock.install();
  await short.hover();
  await page.clock.runFor(600);
  await expect(tooltip).toHaveCount(0);
  await page.getByRole("button", { name: "Full truncated label" }).hover();
  await page.clock.runFor(600);
  await expect(tooltip).toHaveText("Full truncated label");
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  const disabled = page.getByRole("button", { name: "Unavailable action" });
  await expect(disabled).toHaveAccessibleDescription("Choose an archive first");
  await page.keyboard.press("Tab");
  await disabled.focus();
  await page.clock.runFor(300);
  await expect(tooltip).toHaveText("Choose an archive first");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(disabled).toBeFocused();
});

test("tooltip respects native modal ownership and forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/tests/browser/fixtures/?view=tooltip");
  await page.getByRole("button", { name: "Open tooltip dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Tooltip dialog" });
  const trigger = dialog.getByRole("button", { name: "Modal help" });
  await trigger.hover();
  const tooltip = dialog.getByRole("tooltip");
  await expect(tooltip).toHaveText("Modal explanation");
  await expect(tooltip).toHaveCSS("box-shadow", "none");
  await expect(tooltip).toHaveCSS("animation-name", "none");
  await expect
    .poll(() =>
      tooltip.evaluate((node) => {
        const style = getComputedStyle(node);
        return style.color === style.borderTopColor && style.color !== style.backgroundColor;
      }),
    )
    .toBe(true);
  await page.mouse.move(0, 0);
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open tooltip dialog" })).toBeFocused();
});

for (const [theme, query, width] of [
  ["dark", "", 500],
  ["light", "&light", 800],
  ["custom", "&themeStress=distinct", 1100],
] as const) {
  test(`Library toolbar tooltip keeps a natural single-line width (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/fixtures/?view=library-toggles${query}`);
    const trigger = page.getByRole("button", { name: "Select books", exact: true });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await trigger.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveText("Select books");
    await expect(tooltip).toHaveAttribute("data-side", "bottom");
    await expect
      .poll(() =>
        tooltip.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const text = range.getBoundingClientRect();
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const innerWidth =
            node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return (
            range.getClientRects().length === 1 &&
            Math.abs(text.width - innerWidth) <= 1 &&
            box.left >= 7 &&
            box.right <= window.innerWidth - 7
          );
        }),
      )
      .toBe(true);
    const geometry = await tooltip.evaluate((node) => {
      const style = getComputedStyle(node);
      const root = document.documentElement;
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--surface-raised)";
      probe.style.color = "var(--text-strong)";
      probe.style.borderColor = "var(--line)";
      root.append(probe);
      const expected = getComputedStyle(probe);
      const matches =
        style.backgroundColor === expected.backgroundColor &&
        style.color === expected.color &&
        style.borderTopColor === expected.borderTopColor;
      probe.remove();
      return { matches, padding: [style.paddingTop, style.paddingRight] };
    });
    expect(geometry).toEqual({ matches: true, padding: ["6px", "8px"] });
  });
}
