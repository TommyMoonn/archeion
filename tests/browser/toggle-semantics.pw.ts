import { expect, test, type Locator } from "@playwright/test";

async function toggleRepeatedly(control: Locator, state: "aria-pressed" | "aria-checked") {
  await expect(control).toHaveAttribute(state, "false");
  await control.focus();
  for (const active of [true, false, true, false]) {
    await control.press("Space");
    await expect(control).toHaveAttribute(state, String(active));
    await expect(control).toBeFocused();
  }
}

test("bookmark keeps its name and focus through repeated keyboard toggles", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=reader-toggles");
  await toggleRepeatedly(
    page.getByRole("button", { name: "Bookmark", exact: true }),
    "aria-pressed",
  );
});

test("Reader collection controls form a named group with queryable selected state", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=reader-toggles");
  await page.getByRole("button", { name: "Book navigation", exact: true }).click();
  const group = page.getByRole("group", { name: "Book navigation collections" });
  await expect(group.getByRole("button")).toHaveCount(2);
  await expect(group.getByRole("button", { name: "Contents", pressed: true })).toBeVisible();
  await group.getByRole("button", { name: "Pages" }).press("Enter");
  await expect(group.getByRole("button", { name: "Pages", pressed: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Contents", pressed: false })).toBeVisible();
});

test("selection mode keeps a stable name through keyboard toggles", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=library-toggles");
  const filters = page.getByRole("group", { name: "Active filters", exact: true });
  await expect(
    filters.getByRole("button", { name: "Remove Series: Fixture series filter", exact: true }),
  ).toBeVisible();
  await toggleRepeatedly(
    page.getByRole("button", { name: "Select books", exact: true }),
    "aria-pressed",
  );
});

for (const view of ["Grid", "List"]) {
  test(`${view} favorites and selection keep stable names and synchronize state`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/?view=library-toggles");
    const region = page.getByRole("region", { name: `${view} fixture` });
    await toggleRepeatedly(
      region.getByRole("button", { name: "Favorite Fixture", exact: true }),
      "aria-pressed",
    );
    const other = page.getByRole("region", {
      name: `${view === "Grid" ? "List" : "Grid"} fixture`,
    });
    await expect(
      other.getByRole("button", { name: "Favorite Fixture", pressed: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Select books", exact: true }).click();
    await toggleRepeatedly(
      region.getByRole("button", { name: "Select Fixture", exact: true }),
      "aria-pressed",
    );
    await expect(
      other.getByRole("button", { name: "Select Fixture", pressed: false }),
    ).toBeVisible();
  });
}

test("book details favorite retains its name inside the native dialog", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/?view=details-toggle");
  await page.getByRole("button", { name: "Open book details" }).click();
  await toggleRepeatedly(
    page.getByRole("dialog").getByRole("button", { name: "Favorite Fixture", exact: true }),
    "aria-pressed",
  );
});

test("dictionary switch retains its name and checked state through keyboard activation", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/?view=dictionary-toggle");
  await toggleRepeatedly(
    page.getByRole("switch", { name: "Enable English Core", exact: true }),
    "aria-checked",
  );
});
