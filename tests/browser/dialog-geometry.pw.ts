import { expect, test, type Locator, type Page } from "@playwright/test";

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
      footer: { y: footer.y, height: footer.height },
      actions: [...dialog.querySelectorAll(".dialog__footer .button")].map(rect),
    };
  });
}

async function openSurface(page: Page, surface: string, scale = 1) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/tests/browser/fixtures/dialog-geometry.html?surface=${surface}`);
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${16 * size}px`;
  }, scale);
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/\S/);
  expect(await page.locator("dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
}

test("dialog follows the active surface color and keeps descriptions readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openSurface(page, "bulk");
  const dialog = page.getByRole("dialog");
  const description = dialog.getByText(
    "Choose only the fields you intend to change. Unchecked metadata remains untouched.",
  );
  expect(
    await description.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.getBoundingClientRect().height / parseFloat(style.lineHeight);
    }),
  ).toBeLessThanOrEqual(2);
  for (const color of ["rgb(245, 245, 245)", "rgb(20, 25, 30)"]) {
    await page.evaluate(
      (value) => document.documentElement.style.setProperty("--surface-main", value),
      color,
    );
    await expect(dialog).toHaveCSS("background-color", color);
  }
});

for (const surface of ["add", "metadata"]) {
  test(`${surface} dialog actions use the standard control scale`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openSurface(page, surface);

    const actionStyles = await page.locator(".dialog__footer .button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return {
          height: style.height,
          minHeight: style.minHeight,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          paddingInlineStart: style.paddingInlineStart,
        };
      }),
    );

    expect(actionStyles.length).toBeGreaterThan(0);
    for (const style of actionStyles) {
      expect(style).toMatchObject({
        height: "36px",
        minHeight: "36px",
        fontSize: "13px",
        paddingInlineStart: "14px",
      });
      expect(Number.parseFloat(style.lineHeight)).toBeCloseTo(13 * 1.4, 1);
    }

    const openerStyles = await page
      .getByRole("button", { name: "Open dialog", exact: true })
      .evaluate((button) => {
        const style = getComputedStyle(button);
        return { minHeight: style.minHeight, fontSize: style.fontSize };
      });
    expect(openerStyles).toEqual({ minHeight: "40px", fontSize: "14px" });
  });
}

async function expectAlignedControl(page: Page, control: Locator) {
  const dialog = page.getByRole("dialog");
  await expect(control).toBeVisible();
  await expect
    .poll(async () => {
      const [field, title, action] = await Promise.all([
        control.boundingBox(),
        dialog.locator(".dialog__copy").boundingBox(),
        dialog.locator(".dialog__footer .button").last().boundingBox(),
      ]);
      if (!field || !title || !action) return Infinity;
      return Math.max(
        Math.abs(field.x - title.x),
        Math.abs(field.x + field.width - action.x - action.width),
      );
    })
    .toBeLessThanOrEqual(1);
}

async function expectAlignedForm(page: Page, surface: string) {
  const dialog = page.getByRole("dialog");
  const control =
    surface === "rename"
      ? dialog.locator('[data-slot="filename-field"]')
      : surface === "metadata"
        ? dialog.getByRole("textbox", { name: "Title", exact: true })
        : surface === "bulk"
          ? dialog.locator(".bulk-metadata-field--tags")
          : surface === "cover"
            ? dialog.locator(".cover-writeback__book")
            : surface.startsWith("folder")
              ? dialog.getByRole("textbox", { name: "Name", exact: true })
              : dialog.getByRole("combobox").first();
  await expectAlignedControl(page, control);
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
        .map((element) => element.getAttribute("aria-label")),
    );
  expect(overflowOwners).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/ content$/),
      expect.stringMatching(/ feedback$/),
    ]),
  );
  expect(overflowOwners.filter((name) => !name || !/ (content|feedback)$/.test(name))).toEqual([]);
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
      await expectAlignedForm(page, "metadata");
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
      await expectAlignedForm(page, surface);
      if (surface === "bulk") {
        await page.getByRole("checkbox", { name: /^Series/ }).check();
        await page.getByRole("textbox", { name: "New series", exact: true }).fill("New series");
        await page.getByRole("button", { name: "Review changes" }).click();
      }
      // Review introduces semibold preview text. Establish its loaded font geometry
      // before comparing operation states, independently of network/font startup.
      await page.evaluate(() => document.fonts.ready);
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

test("Add EPUB distinguishes the busy picker and import errors in forced colors", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openSurface(page, "add");
  const dialog = page.getByRole("dialog", { name: "Add EPUB files" });
  const picker = dialog.getByRole("button", { name: "book.epub" });
  await dialog.getByRole("button", { name: "Add EPUB" }).click();
  await expect(picker).toBeDisabled();
  await expect(picker).toHaveCSS("opacity", "0.6");
  await page.evaluate(() => window.dialogGeometryFixture.release(true));
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Synthetic operation failure");
  expect(
    await alert.evaluate((element) => {
      const style = getComputedStyle(element);
      const sample = document.createElement("span");
      sample.style.forcedColorAdjust = "none";
      sample.style.color = "MarkText";
      sample.style.backgroundColor = "Mark";
      element.append(sample);
      const system = getComputedStyle(sample);
      const matches =
        style.color === system.color && style.backgroundColor === system.backgroundColor;
      sample.remove();
      return matches;
    }),
  ).toBe(true);
});

for (const scale of [1, 2]) {
  test(`cover preparation, retry, write and warning preserve geometry text ${scale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 520 });
    await openSurface(page, "cover", scale);
    await expectAlignedForm(page, "cover");
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

test("folder move keeps a scrollable destination list inside the modal", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 550 });
  await openSurface(page, "move-folder", 2);
  const dialog = page.getByRole("dialog", { name: "Move folder" });
  const destination = dialog.getByRole("combobox", { name: /Destination/ });
  const move = dialog.getByRole("button", { name: "Move", exact: true });
  await expect(move).toBeDisabled();
  await expect(destination).toHaveAccessibleName(/Archive root/);
  await expectAlignedControl(page, destination);

  await destination.press("Enter");
  const list = dialog.getByRole("listbox");
  await expect(list.getByRole("option", { name: "Archive root" })).toBeFocused();
  const source = list.getByRole("option", { name: "Fiction", exact: true });
  const descendant = list.getByRole("option", { name: "Fiction/Classics", exact: true });
  await expect(source).toBeDisabled();
  await expect(descendant).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(source).toHaveAttribute("aria-selected", "false");
  await expect(move).toBeDisabled();
  await page.keyboard.press("End");
  const last = list.getByRole("option", { name: "Shelf 24" });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(destination).toBeFocused();
  await expect(move).toBeDisabled();

  await destination.press("End");
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(destination).toHaveAccessibleName(/Shelf 24/);
  await expect(move).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open dialog" })).toBeFocused();
});

for (const [surface, submitName] of [
  ["rename", "Rename file"],
  ["folder", "Save"],
]) {
  test(`${surface} validation remains associated and Escape restores focus`, async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 520 });
    await openSurface(page, surface, 2);
    const baseline = await bounds(page);
    const input = page.getByRole("textbox");
    await input.fill("");
    await page.getByRole("button", { name: submitName, exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(/Enter a (filename|folder name)/);
    await expect(input).toBeFocused();
    expect(await bounds(page)).toEqual(baseline);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  });
}

for (const forcedColors of ["none", "active"] as const) {
  test(`filename field owns keyboard focus and pointer validation in forced colors ${forcedColors}`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors });
    await page.goto("/tests/browser/fixtures/dialog-geometry.html?surface=rename");
    await page.getByRole("button", { name: "Open dialog", exact: true }).press("Enter");

    const input = page.getByRole("textbox", { name: /^Filename/ });
    const field = page.getByRole("dialog").locator('[data-slot="filename-field"]');
    const suffix = page.getByText(".epub", { exact: true });
    await expect(field).toHaveCSS("transition-property", "border-color, box-shadow");
    await expect(suffix).toHaveCSS("transition-property", "border-inline-start-color, color");
    await expect(input).toBeFocused();
    await expect(input).toHaveAccessibleDescription(".epub");
    await input.press("Shift+Tab");
    await expect(page.getByRole("region", { name: "Rename EPUB file content" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
    await expect(field).toHaveCSS("outline-style", "solid");
    await expect(field).toHaveCSS("outline-width", "2px");
    await expect(field).toHaveCSS("outline-offset", "2px");
    await expect(input).toHaveCSS("outline-style", "none");

    await page.keyboard.press("Shift+Tab");
    await expect(input).not.toBeFocused();
    await suffix.click();
    await expect(input).toBeFocused();
    await expect(field).toHaveCSS("outline-style", "none");
    await input.fill("");
    await page.getByRole("button", { name: "Rename file", exact: true }).click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAccessibleDescription(".epub Enter a filename.");
    await expect(field).toHaveCSS("outline-style", "dashed");
    await expect(field).toHaveCSS("outline-width", "2px");
    await expect(field).toHaveCSS("outline-offset", "2px");
    await expect(input).toHaveCSS("outline-style", "none");
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
    await expectAlignedForm(page, surface);
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
  });
}

test("bulk fields preserve checkbox hit targets, editable values and compact geometry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 520 });
  await openSurface(page, "bulk", 2);
  const dialog = page.getByRole("dialog");
  const series = dialog.getByRole("checkbox", { name: "Series", exact: true });
  const input = dialog.getByRole("textbox", { name: "New series" });
  await expect(input).toBeDisabled();
  await expect(series).toHaveCSS("width", "15px");
  await expect(series).toHaveCSS("height", "15px");
  await expect(input).toHaveCSS("min-height", "34px");
  await dialog.getByText("Series", { exact: true }).click();
  await expect(series).toBeChecked();
  await expect(input).toBeEnabled();
  await input.fill("A long multilingual series 日本語 Ελληνικά ".repeat(8));
  await series.focus();
  await page.keyboard.press("Space");
  await expect(series).not.toBeChecked();
  await expect(input).toBeDisabled();
  await page.keyboard.press("Space");
  await expect(series).toBeChecked();
  await expect(input).toHaveValue(/^A long multilingual series/);
  const tags = dialog.getByRole("checkbox", { name: "Tags", exact: true });
  await tags.check();
  const textarea = dialog.getByRole("textbox", { name: "Tags to apply" });
  await textarea.fill("One tag\nAnother tag");
  await expect(textarea).toHaveValue("One tag\nAnother tag");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Review changes" })).toBeInViewport();
  await expect(textarea).toBeInViewport();
  await page.emulateMedia({ forcedColors: "active" });
  await tags.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(tags).toBeFocused();
  await expect(tags).toHaveCSS("outline-style", "solid");
  await expect(tags).toHaveCSS("outline-width", "2px");
});
