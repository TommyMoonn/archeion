import { expect, test, type Page } from "@playwright/test";

async function openWorkspace(page: Page, surface: string, scale = 1) {
  await page.goto(`/tests/browser/fixtures/dialog-workspace.html?surface=${surface}`);
  await page.evaluate((scale) => {
    document.documentElement.style.fontSize = `${scale * 16}px`;
  }, scale);
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
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
    const preview = dialog.querySelector(".cover-writeback__preview");
    const controls = dialog.querySelector(".cover-writeback__controls");
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

test("desktop metadata gives its form the available height without pending/status shifts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openWorkspace(page, "metadata");
  const baseline = await capture(page, "metadata-initial");
  expect.soft(baseline.body.height).toBeGreaterThanOrEqual(600);
  const emptySummary = await page.locator(".metadata-writeback__changes").evaluate((summary) => ({
    bottom: summary.getBoundingClientRect().bottom,
    feedbackBottom: summary.closest(".dialog__feedback")!.getBoundingClientRect().bottom,
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

for (const surface of ["metadata"]) {
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
