import { expect, test, type Page } from "@playwright/test";

async function openWorkspace(page: Page, surface: string, scale = 1) {
  await page.goto(`/tests/browser/fixtures/dialog-workspace.html?surface=${surface}`);
  await page.evaluate((scale) => {
    document.documentElement.style.fontSize = `${scale * 16}px`;
  }, scale);
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator("dialog").evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
}

async function capture(page: Page, state: string) {
  await page.locator("dialog").evaluate(async (dialog) => {
    await Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished));
  });
  const geometry = await page.locator("dialog").evaluate((dialog) => {
    const body = dialog.querySelector<HTMLElement>(".dialog__body")!;
    const feedback = dialog.querySelector<HTMLElement>(".dialog__feedback")!;
    const footer = dialog.querySelector<HTMLElement>(".dialog__footer")!;
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const content = body.lastElementChild!;
    const contentBottom =
      content.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
    const preview = dialog.querySelector('[data-slot="cover-editor-preview"]');
    const controls = dialog.querySelector('[data-slot="cover-editor-controls"]');
    return {
      outer: rect(dialog),
      title: rect(dialog.querySelector(".dialog__copy")!),
      footer: rect(footer),
      body: rect(body),
      feedback: rect(feedback),
      bodyScrollHeight: body.scrollHeight,
      unusedBody: Math.max(0, body.clientHeight - contentBottom),
      // Empty body tail plus spacing and reserved feedback before the persistent action row.
      contentToActions:
        footer.getBoundingClientRect().top - body.getBoundingClientRect().top - contentBottom,
      alignment:
        preview && controls
          ? Math.abs(preview.getBoundingClientRect().top - controls.getBoundingClientRect().top)
          : null,
      viewportHeight: window.innerHeight,
    };
  });
  await test.info().attach(`${state}-geometry`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });
  await test.info().attach(`${state}-production-components`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  return geometry;
}

function stable(
  current: Awaited<ReturnType<typeof capture>>,
  baseline: Awaited<ReturnType<typeof capture>>,
) {
  expect(current.outer).toEqual(baseline.outer);
  expect(current.title).toEqual(baseline.title);
  expect(current.footer.y).toBe(baseline.footer.y);
  expect(current.outer.y + current.outer.height).toBeLessThanOrEqual(current.viewportHeight);
}

async function release(page: Page, message?: string) {
  await expect(page.locator("body")).toHaveAttribute("data-operation", "pending");
  await page.evaluate((message) => window.workspaceFixture.release(message), message);
}

test("desktop cover uses content-sized workspace and proportionate feedback through all states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openWorkspace(page, "cover");
  const baseline = await capture(page, "cover-initial");
  expect(baseline.outer.width).toBe(820);
  await page.getByRole("button", { name: "Choose image", exact: true }).click();
  stable(await capture(page, "cover-preparing"), baseline);
  await release(page);
  await expect(
    page.getByRole("button", { name: "Write cover to EPUB", exact: true }),
  ).toBeEnabled();
  const prepared = await capture(page, "cover-prepared");
  stable(prepared, baseline);
  expect(prepared.alignment).toBeLessThanOrEqual(1);
  expect(prepared.unusedBody).toBeLessThanOrEqual(4);
  // Inline feedback shares the action row; only the ordinary body/footer spacing remains.
  expect.soft(prepared.contentToActions).toBeLessThanOrEqual(32);
  expect.soft(prepared.bodyScrollHeight).toBeLessThanOrEqual(prepared.body.height + 1);
  for (const message of [
    "Cannot write this EPUB.",
    "Long failure 日本語 Ελληνικά العربية. ".repeat(40),
    undefined,
  ]) {
    await page.getByRole("button", { name: "Write cover to EPUB", exact: true }).click();
    stable(await capture(page, "cover-writing"), baseline);
    await release(page, message);
    if (message) await expect(page.getByRole("alert")).toContainText(message);
    else await expect(page.getByRole("status").first()).toContainText("Cover written");
    stable(await capture(page, message ? "cover-error" : "cover-success"), baseline);
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  await test
    .info()
    .attach("cover-closed", { body: await page.screenshot(), contentType: "image/png" });
});

test("desktop metadata gives its form the available height without pending/status shifts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openWorkspace(page, "metadata");
  const baseline = await capture(page, "metadata-initial");
  expect.soft(baseline.body.height).toBeGreaterThanOrEqual(600);
  const emptySummary = await page.getByText("Pending changes").evaluate((heading) => ({
    bottom: heading.closest("section")!.getBoundingClientRect().bottom,
    feedbackBottom: heading.closest(".dialog__feedback")!.getBoundingClientRect().bottom,
  }));
  expect(emptySummary.bottom).toBeLessThanOrEqual(emptySummary.feedbackBottom);
  await page.locator(".dialog__body").focus();
  await page.keyboard.press("Control+End");
  await capture(page, "metadata-scrolled");
  await page.keyboard.press("Control+Home");
  await page
    .getByRole("textbox", { name: "Subjects", exact: true })
    .fill("Changed 日本語 Ελληνικά العربية subjects");
  stable(await capture(page, "metadata-one-change"), baseline);
  await expect(page.getByRole("status")).toHaveCSS("position", "absolute");
  const summaryOverflow = () =>
    page.locator(".dialog__feedback").evaluate((feedback) => ({
      content: feedback.scrollHeight,
      available: feedback.clientHeight,
      summary: feedback.firstElementChild!.getBoundingClientRect().height,
    }));
  const oneChanged = await summaryOverflow();
  expect.soft(oneChanged.content).toBeLessThanOrEqual(oneChanged.available + 1);
  for (const name of [
    "Title",
    "Author",
    "Language",
    "Publisher",
    "Date",
    "Description",
    "Subjects",
    "Series",
    "Volume",
  ]) {
    await page
      .getByRole("textbox", { name, exact: true })
      .fill(`Changed ${name} 日本語 Ελληνικά العربية`);
  }
  stable(await capture(page, "metadata-many-changes"), baseline);
  const allChanged = await summaryOverflow();
  expect.soft(allChanged.content).toBeLessThanOrEqual(allChanged.available + 1);
  for (const message of ["Long metadata error 日本語 Ελληνικά العربية. ".repeat(40), undefined]) {
    await page.getByRole("button", { name: "Write metadata to EPUB", exact: true }).click();
    stable(await capture(page, "metadata-writing"), baseline);
    await release(page, message);
    if (message) await expect(page.getByRole("alert")).toContainText(message);
    else await expect(page.getByRole("status")).toContainText("Metadata written");
    stable(await capture(page, message ? "metadata-error" : "metadata-success"), baseline);
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
  await test
    .info()
    .attach("metadata-closed", { body: await page.screenshot(), contentType: "image/png" });
});

test("metadata preserves the inclusive breakpoint and wraps the full read-only identifier", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openWorkspace(page, "metadata");
  const dialog = page.getByRole("dialog", { name: "Edit EPUB metadata" });
  await expect(dialog).toHaveCSS("width", "800px");
  const title = dialog.getByRole("textbox", { name: "Title", exact: true });
  const author = dialog.getByRole("textbox", { name: "Author", exact: true });
  const language = dialog.getByRole("textbox", { name: "Language", exact: true });
  const fieldWidths = () =>
    Promise.all([title, author, language].map((field) => field.evaluate((f) => f.clientWidth)));
  await expect(language).toHaveCSS("width", "180px");
  await page.setViewportSize({ width: 721, height: 900 });
  const [wideTitle, wideAuthor] = await fieldWidths();
  expect(wideAuthor).toBeLessThan(wideTitle);
  await page.setViewportSize({ width: 720, height: 900 });
  await expect
    .poll(async () => {
      const [titleWidth, authorWidth, languageWidth] = await fieldWidths();
      return titleWidth === authorWidth && titleWidth === languageWidth;
    })
    .toBe(true);

  await page.setViewportSize({ width: 400, height: 550 });
  const identifier = dialog.getByText(/^urn:isbn:/);
  await expect(dialog.getByRole("textbox", { name: "Identifier", exact: true })).toHaveCount(0);
  expect(
    await identifier.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const bounds = element.getBoundingClientRect();
      const lines = Array.from(range.getClientRects());
      return lines.length > 1 && lines.every((line) => line.left >= bounds.left - 1);
    }),
  ).toBe(true);
});

for (const forcedColors of ["none", "active"] as const) {
  test(`metadata keeps keyboard focus and discards a closed draft in forced-colors ${forcedColors}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 750 });
    await page.emulateMedia({ forcedColors });
    await openWorkspace(page, "metadata");
    const open = page.getByRole("button", { name: "Open dialog", exact: true });
    const dialog = page.getByRole("dialog", { name: "Edit EPUB metadata" });
    const title = dialog.getByRole("textbox", { name: "Title", exact: true });
    const description = dialog.getByRole("textbox", { name: "Description", exact: true });
    for (const field of [title, description]) {
      await field.click();
      await expect(field).toHaveCSS("outline-style", "none");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(field).toBeFocused();
      await expect(field).toHaveCSS("outline-style", "solid");
      await expect(field).toHaveCSS("outline-width", "2px");
      await expect(field).toHaveCSS("outline-offset", "2px");
    }

    const original = await title.inputValue();
    await title.fill("Unsaved title");
    await expect(dialog.getByRole("list", { name: "Changed metadata fields" })).toHaveText("Title");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.press("Enter");
    await expect(title).toHaveValue(original);
    await expect(dialog.getByRole("button", { name: "Write metadata to EPUB" })).toBeDisabled();
    await expect(page.locator("body")).not.toHaveAttribute("data-operation", "pending");
  });
}

test("metadata writeback errors retain their forced-color emphasis", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openWorkspace(page, "metadata");
  const dialog = page.getByRole("dialog", { name: "Edit EPUB metadata" });
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Edited title");
  await dialog.getByRole("button", { name: "Write metadata to EPUB" }).click();
  await release(page, "This EPUB could not be written.");
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveText("This EPUB could not be written.");
  const colors = await alert.evaluate((element) => {
    const style = getComputedStyle(element);
    const sample = document.createElement("span");
    sample.style.cssText = "color: MarkText; background: Mark; border: 1px solid Mark;";
    document.body.append(sample);
    const expected = getComputedStyle(sample);
    const values = (style: CSSStyleDeclaration) => [
      style.color,
      style.backgroundColor,
      style.borderTopColor,
    ];
    return { actual: values(style), expected: values(expected) };
  });
  expect(colors.actual).toEqual(colors.expected);
});

for (const surface of ["cover", "metadata"]) {
  for (const motion of ["on", "off", "reduced"] as const) {
    test(`${surface} keyboard scroll, long feedback and focus at 480x520 with 200% text, motion ${motion}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 480, height: 520 });
      await page.emulateMedia({ reducedMotion: motion === "reduced" ? "reduce" : "no-preference" });
      await openWorkspace(page, surface, 2);
      await page.evaluate((motion) => {
        document.documentElement.dataset.motion = motion === "off" ? "off" : "on";
      }, motion);
      const baseline = await capture(page, `${surface}-small-initial`);
      if (surface === "cover") {
        await page.getByRole("button", { name: "Choose image", exact: true }).click();
        await release(page);
        await expect(
          page.getByRole("button", { name: "Write cover to EPUB", exact: true }),
        ).toBeEnabled();
      }
      const body = page.locator(".dialog__body");
      await body.focus();
      await page.keyboard.press("Control+End");
      await expect
        .poll(() => body.evaluate((body) => body.scrollHeight - body.clientHeight - body.scrollTop))
        .toBeLessThanOrEqual(1);
      await capture(page, `${surface}-small-scrolled`);
      await page.keyboard.press("Control+Home");
      await expect.poll(() => body.evaluate((body) => body.scrollTop)).toBe(0);
      const visited = new Set<string>();
      for (let index = 0; index < 22; index++) {
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement;
          const body = active.closest(".dialog__body");
          const bounds = active.getBoundingClientRect();
          const container = (body ?? active.closest("dialog"))?.getBoundingClientRect();
          return {
            inside: Boolean(active.closest("dialog")),
            browserChrome: !document.hasFocus() && active === document.body,
            name: active.getAttribute("name") ?? active.textContent?.trim() ?? "",
            visible:
              !container ||
              Math.min(bounds.bottom, container.bottom) - Math.max(bounds.top, container.top) > 0,
          };
        });
        expect(focus.inside || focus.browserChrome).toBe(true);
        expect(focus.visible).toBe(true);
        visited.add(focus.name);
      }
      expect(visited.has("Close")).toBe(true);
      expect(
        visited.has(surface === "cover" ? "Choose another image" : "archeion-epub-metadata-title"),
      ).toBe(true);
      expect(visited.has(surface === "cover" ? "Crop" : "archeion-epub-metadata-description")).toBe(
        true,
      );
      if (surface === "metadata") {
        await page
          .getByRole("textbox", { name: "Title", exact: true })
          .fill("Changed 日本語 Ελληνικά العربية");
        expect(
          await page
            .locator(".dialog__feedback")
            .evaluate((feedback) => feedback.scrollHeight - feedback.clientHeight),
        ).toBeLessThanOrEqual(1);
      }
      const action = page.getByRole("button", {
        name: surface === "cover" ? "Write cover to EPUB" : "Write metadata to EPUB",
        exact: true,
      });
      await action.click();
      const message = "Long validation error 日本語 Ελληνικά العربية. ".repeat(50);
      await release(page, message);
      await expect(page.getByRole("alert")).toContainText(message);
      stable(await capture(page, `${surface}-small-error`), baseline);
      const feedback = page.locator(".dialog__feedback");
      await feedback.focus();
      await page.keyboard.press("Control+End");
      await expect
        .poll(() =>
          feedback.evaluate(
            (feedback) => feedback.scrollHeight - feedback.clientHeight - feedback.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
      expect(await feedback.evaluate((feedback) => feedback.scrollTop)).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Close", exact: true }).focus();
      await expect(page.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open dialog", exact: true })).toBeFocused();
    });
  }
}
