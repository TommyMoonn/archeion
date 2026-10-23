import { expect, test, type Page } from "@playwright/test";

async function bounds(page: Page) {
  return page.locator("dialog[open]").evaluate((dialog) => {
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const footer = rect(dialog.querySelector(".dialog__footer")!);
    return {
      outer: rect(dialog),
      header: rect(dialog.querySelector(".dialog__copy")!),
      // Busy-label width is owned by phase 1.8.0.14; this phase fixes the action row's Y/height.
      footer: { y: footer.y, height: footer.height },
    };
  });
}

async function openSurface(page: Page, surface: string, scale = 1) {
  await page.goto(`/tests/browser/fixtures/dialog-geometry.html?surface=${surface}`);
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${16 * size}px`;
  }, scale);
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/\S/);
  expect(await page.locator("dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
}

async function reachableShell(page: Page) {
  const geometry = await bounds(page);
  const viewport = page.viewportSize()!;
  expect(geometry.outer.y).toBeGreaterThanOrEqual(0);
  expect(geometry.outer.y + geometry.outer.height).toBeLessThanOrEqual(viewport.height);
  expect(geometry.footer.y + geometry.footer.height).toBeLessThanOrEqual(
    geometry.outer.y + geometry.outer.height,
  );
  expect(geometry.footer.y).toBeGreaterThanOrEqual(geometry.header.y + geometry.header.height);
  expect(
    await page.locator("dialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  // Only the shared body/feedback slots own shell scrolling, not the old panel or feature wrappers.
  const overflowOwners = await page
    .locator("dialog div, dialog section")
    .evaluateAll((elements) =>
      elements
        .filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY))
        .map((element) => element.className),
    );
  expect(overflowOwners).toEqual(expect.arrayContaining(["dialog__body", "dialog__feedback"]));
  expect(
    overflowOwners.filter((name) => name !== "dialog__body" && name !== "dialog__feedback"),
  ).toEqual([]);
}

async function keyboardScroll(page: Page, selector: string) {
  const region = page.locator(selector);
  await region.focus();
  await page.keyboard.press("Control+End");
  await expect
    .poll(() =>
      region.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeLessThanOrEqual(1);
}

async function containedTabOrder(page: Page) {
  const visited = new Set<string>();
  for (let index = 0; index < 25; index++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({
      inside: Boolean(document.activeElement?.closest("dialog")),
      browserChrome: !document.hasFocus() && document.activeElement === document.body,
      text: document.activeElement?.textContent?.trim() ?? "",
    }));
    // Chromium may tab into browser chrome. Background document controls must stay inert.
    expect(focus.inside || focus.browserChrome).toBe(true);
    visited.add(focus.text);
  }
  expect([...visited].some((text) => /^(Close|Cancel|Back)$/.test(text))).toBe(true);
}

for (const viewport of [
  { width: 1100, height: 900 },
  { width: 480, height: 520 },
]) {
  for (const scale of [1, 2]) {
    test(`metadata pending changes and outcomes preserve geometry ${viewport.width} text ${scale}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openSurface(page, "metadata", scale);
      const baseline = await bounds(page);
      await reachableShell(page);
      await keyboardScroll(page, ".dialog__body");
      await page.getByRole("textbox", { name: "Title", exact: true }).fill("Changed title");
      expect(await bounds(page)).toEqual(baseline);
      await keyboardScroll(page, ".dialog__feedback");
      await containedTabOrder(page);
      for (const name of [
        "Author",
        "Language",
        "Publisher",
        "Date",
        "Subjects",
        "Series",
        "Volume",
      ]) {
        await page.getByRole("textbox", { name, exact: true }).fill(`Changed ${name}`);
      }
      expect(await bounds(page)).toEqual(baseline);
      await page.getByRole("button", { name: "Write metadata to EPUB", exact: true }).click();
      await expect(page.locator("body")).toHaveAttribute("data-operation", "pending");
      expect(await bounds(page)).toEqual(baseline);
      await page.evaluate(() => window.dialogGeometryFixture.release(true));
      await expect(page.getByRole("alert")).toContainText("Synthetic operation failure");
      expect(await bounds(page)).toEqual(baseline);
      await page.getByRole("button", { name: "Write metadata to EPUB", exact: true }).click();
      await page.evaluate(() => window.dialogGeometryFixture.release());
      await expect(page.getByRole("status")).toContainText("Metadata written to EPUB");
      expect(await bounds(page)).toEqual(baseline);
    });
  }
}

for (const surface of ["add", "move", "rename", "folder", "bulk"]) {
  for (const scale of [1, 2]) {
    test(`${surface} failure preserves shell and reachable actions text ${scale}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 480, height: 520 });
      await openSurface(page, surface, scale);
      if (surface === "bulk") {
        await page.getByRole("checkbox", { name: /^Series/ }).check();
        await page.getByRole("textbox", { name: "New series", exact: true }).fill("New series");
        await page.getByRole("button", { name: "Review changes" }).click();
      }
      const baseline = await bounds(page);
      await reachableShell(page);
      await page.locator(".dialog__footer .button--primary").click();
      await expect(page.locator("body")).toHaveAttribute("data-operation", "pending");
      expect(await bounds(page)).toEqual(baseline);
      await page.evaluate(() => window.dialogGeometryFixture.release(true));
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await bounds(page)).toEqual(baseline);
      await keyboardScroll(page, ".dialog__feedback");
      await containedTabOrder(page);
      await page.locator(".dialog__footer .button--primary").click();
      await page.evaluate(() => window.dialogGeometryFixture.release());
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
    });
  }
}

for (const scale of [1, 2]) {
  test(`cover preparation, retry, write and warning preserve geometry text ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 520 });
    await openSurface(page, "cover", scale);
    const baseline = await bounds(page);
    await reachableShell(page);
    await page.getByRole("button", { name: "Choose image", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-operation", "pending");
    expect(await bounds(page)).toEqual(baseline);
    await page.evaluate(() => window.dialogGeometryFixture.release(true));
    await expect(page.getByRole("alert")).toContainText("Synthetic operation failure");
    expect(await bounds(page)).toEqual(baseline);
    await page.getByRole("button", { name: "Choose another image", exact: true }).click();
    await page.evaluate(() => window.dialogGeometryFixture.release());
    await expect(
      page.getByRole("button", { name: "Write cover to EPUB", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(await bounds(page)).toEqual(baseline);
    await page.getByRole("button", { name: "Write cover to EPUB", exact: true }).click();
    expect(await bounds(page)).toEqual(baseline);
    await page.evaluate(() => window.dialogGeometryFixture.release(true));
    await expect(page.getByRole("alert")).toContainText("Synthetic operation failure");
    expect(await bounds(page)).toEqual(baseline);
    await page.getByRole("button", { name: "Write cover to EPUB", exact: true }).click();
    await page.evaluate(() => window.dialogGeometryFixture.release());
    await expect(page.getByRole("status").first()).toContainText("Cover written to EPUB");
    await expect(page.getByRole("status").last()).toContainText("Synthetic cache warning");
    expect(await bounds(page)).toEqual(baseline);
    await keyboardScroll(page, ".dialog__feedback");
    await containedTabOrder(page);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  });
}

for (const width of [480, 1100]) {
  test(`cover explicit write, aligned controls and keyboard navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 480 ? 520 : 900 });
    await openSurface(page, "cover");
    await page.getByRole("button", { name: "Choose image", exact: true }).click();
    await page.evaluate(() => window.dialogGeometryFixture.release());
    const fit = page.getByRole("radio", { name: "Fit", exact: true });
    await page.getByRole("radio", { name: "Crop", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(fit).toBeFocused();
    await page.evaluate(() => window.dialogGeometryFixture.release());
    await expect(fit).toHaveAttribute("aria-checked", "true");
    expect(await page.locator("body").getAttribute("data-cover-writes")).toBeNull();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await reachableShell(page);
    await containedTabOrder(page);
    if (width === 1100) {
      const tops = await page
        .locator(".cover-writeback__workspace")
        .evaluate((workspace) => [
          workspace.querySelector(".cover-writeback__preview")!.getBoundingClientRect().top,
          workspace.querySelector(".cover-writeback__controls")!.getBoundingClientRect().top,
        ]);
      expect(Math.abs(tops[0] - tops[1])).toBeLessThanOrEqual(1);
    }
    await page.locator(".dialog__body").evaluate((body) => {
      body.scrollTop = 0;
    });
    await test.info().attach(`cover-${width}-preview`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.locator(".dialog__body").evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    await test.info().attach(`cover-${width}-prepared`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "Write cover to EPUB", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(fit).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-cover-writes", "1");
    await page.evaluate(() => window.dialogGeometryFixture.release());
    await expect(page.getByRole("status").first()).toContainText("Cover written to EPUB");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  });
}

for (const surface of ["rename", "folder"]) {
  test(`${surface} validation remains associated and Escape restores focus`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 520 });
    await openSurface(page, surface, 2);
    const baseline = await bounds(page);
    const input = page.getByRole("textbox");
    await input.fill("");
    await page.locator(".dialog__footer .button--primary").click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(/Enter a (filename|folder name)/);
    await expect(input).toBeFocused();
    expect(await bounds(page)).toEqual(baseline);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  });
}

for (const motion of ["on", "off", "reduced"] as const) {
  test(`native cancel, backdrop and keyboard containment with motion ${motion}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: motion === "reduced" ? "reduce" : "no-preference" });
    await page.goto("/tests/browser/fixtures/dialog-geometry.html?surface=rename");
    await page.evaluate((mode) => {
      document.documentElement.dataset.motion = mode === "off" ? "off" : "on";
    }, motion);
    await page.getByRole("button", { name: "Open dialog", exact: true }).click();
    await containedTabOrder(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Open dialog", exact: true }).click();
    await page.mouse.click(1, 1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

for (const surface of ["add-empty", "move", "rename", "folder-create", "folder", "bulk"]) {
  test(`${surface} keeps short content compact at desktop size`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openSurface(page, surface);
    const spacing = await page.locator("dialog").evaluate((dialog) => {
      const body = dialog.querySelector(".dialog__body")!;
      const feedback = dialog.querySelector(".dialog__feedback");
      const footer = dialog.querySelector(".dialog__footer")!;
      const contentBottom = body.lastElementChild!.getBoundingClientRect().bottom;
      return {
        unusedBody: body.getBoundingClientRect().bottom - contentBottom,
        actionGap: footer.getBoundingClientRect().top - contentBottom,
        feedbackHeight: feedback?.getBoundingClientRect().height ?? 0,
        twoLines: 2 * parseFloat(getComputedStyle(feedback ?? body).fontSize) * 1.4,
      };
    });
    expect(spacing.unusedBody).toBeLessThanOrEqual(4);
    // Two text lines plus ordinary field/action spacing, not an empty editor viewport.
    expect(spacing.actionGap).toBeLessThanOrEqual(24);
    expect(spacing.feedbackHeight).toBeLessThanOrEqual(spacing.twoLines + 6);
    if (["rename", "folder", "folder-create"].includes(surface)) {
      await expect(page.getByText("Required", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("textbox")).toHaveAttribute("required", "");
    }
    if (surface === "folder-create") {
      await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveAttribute(
        "placeholder",
        "e.g. Fiction",
      );
      const baseline = await bounds(page);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Enter a folder name");
      expect(await bounds(page)).toEqual(baseline);
    }
    await test.info().attach(`${surface}-desktop`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}
