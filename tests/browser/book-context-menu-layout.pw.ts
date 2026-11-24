import { expect, test } from "@playwright/test";

const labels = [
  "Read",
  "Add favorite",
  "Edit metadata",
  "Rename file",
  "Move to folder",
  "Reveal in folder",
  "Delete EPUB",
];

test("book context menu keeps mono-font actions on one line and sizes to its content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 248, height: 353 });
  const stylesheet = await page.request.get("/src/styles/index.css?direct");
  expect(stylesheet.ok()).toBe(true);
  const styles = await stylesheet.text();
  await page.setContent(`
    <style>${styles}</style>
    <style>html { font-size: 16px; } :root { --font-ui: monospace; }</style>
    <div class="context-menu menu-popover book-menu__popover" role="menu">
      ${labels
        .map(
          (label) => `
            <button class="menu-item" role="menuitem" type="button">
              <span aria-hidden="true" class="menu-item__icon icon-slot"><span class="fixture-icon"></span></span>
              <span class="menu-item__label">${label}</span>
            </button>
          `,
        )
        .join("\n")}
    </div>
  `);

  const menu = page.locator(".book-menu__popover");
  const metrics = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const labels = Array.from(element.querySelectorAll<HTMLElement>(".menu-item__label"));
    return {
      width: rect.width,
      maxWidth: Number.parseFloat(getComputedStyle(element).maxWidth),
      labels: labels.map((label) => ({
        text: label.textContent,
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
        whiteSpace: getComputedStyle(label).whiteSpace,
      })),
    };
  });

  expect(metrics.width).toBeGreaterThan(168);
  expect(metrics.width).toBeLessThanOrEqual(metrics.maxWidth);
  expect(metrics.labels.map((label) => label.text)).toEqual(labels);
  expect(metrics.labels.every((label) => label.whiteSpace === "nowrap")).toBe(true);
  expect(metrics.labels.every((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
});
