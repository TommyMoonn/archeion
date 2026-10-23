import { expect, test } from "@playwright/test";

// The production-route fixture has a substantial cold Vite module graph on Windows.
test.setTimeout(120_000);
test.use({ trace: "on" });

for (const view of ["grid", "list"] as const) {
  for (const count of [48, 49, 500, 3000]) {
    for (const position of [0, 0.5, 1]) {
      test(`${view} ${count} books returns at ${position}`, async ({ page }, info) => {
        if (count === 500) await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(
          `/tests/browser/fixtures/ui-stability.html?count=${count}${count === 49 ? "&motion=off" : ""}`,
          {
            waitUntil: "domcontentloaded",
          },
        );
        await expect(page.locator(".book-grid")).toBeVisible();
        await page.evaluate((next) => window.uiStabilityFixture.setView(next), view);
        const collection = page.locator(view === "grid" ? ".book-grid" : ".book-list");
        await expect(collection).toBeVisible();
        await page.locator(".library-content--books").evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished));
        });
        await page.locator(".page-shell").evaluate((node, fraction) => {
          node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction;
        }, position);
        await expect.poll(async () => collection.getAttribute("data-window-start")).not.toBeNull();
        // Let the retained range and row ResizeObserver commit before selecting a visible book.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const visibleId = () =>
          collection.evaluate((node, position) => {
            const root = node.closest(".page-shell")!.getBoundingClientRect();
            const books = Array.from(node.querySelectorAll<HTMLElement>("[data-reader-book-id]"));
            if (position === 1) books.reverse();
            const book = books.find((book) => {
              const rect = book.getBoundingClientRect();
              return rect.top >= root.top && rect.bottom <= root.bottom;
            });
            if (!book) return undefined;
            // Activate the chosen retained row in the same DOM snapshot. A delayed
            // measurement can replace that row between a separate ID read and click.
            const button = book.querySelector<HTMLButtonElement>("button")!;
            button.focus({ preventScroll: true });
            button.click();
            return book.dataset.readerBookId;
          }, position);
        let id: string | undefined;
        await expect
          .poll(async () => {
            id = await visibleId();
            return id;
          })
          .toBeTruthy();
        const target = page.locator(`[data-reader-book-id="${id}"]`);
        const y = await target.evaluate(
          (node) =>
            node.getBoundingClientRect().top -
            node.closest(".page-shell")!.getBoundingClientRect().top,
        );
        const savedScrollTop = await page.locator(".page-shell").evaluate((root) => root.scrollTop);
        await page.getByRole("button", { name: "Read book", exact: true }).click();
        await expect(page.locator(".epub-container iframe").first()).toBeVisible();
        const recording = await page.evaluateHandle((id) => {
          const frames: {
            scrollTop: number;
            y: number | null;
            time: number;
            visible: boolean;
            entranceY: number;
          }[] = [];
          let active = true;
          const sample = () => {
            const root = document.querySelector<HTMLElement>(".page-shell");
            const book = document.querySelector<HTMLElement>(`[data-reader-book-id="${id}"]`);
            const collection = document.querySelector<HTMLElement>(".collection-content__items");
            const boundary = collection?.closest<HTMLElement>(".library-content--books");
            if (root)
              frames.push({
                time: performance.now(),
                scrollTop: root.scrollTop,
                entranceY:
                  boundary && getComputedStyle(boundary).transform !== "none"
                    ? new DOMMatrixReadOnly(getComputedStyle(boundary).transform).m42
                    : 0,
                visible: Boolean(
                  collection &&
                  boundary &&
                  getComputedStyle(collection).visibility === "visible" &&
                  Number(getComputedStyle(boundary).opacity) > 0.001,
                ),
                y: book
                  ? book.getBoundingClientRect().top - root.getBoundingClientRect().top
                  : null,
              });
            if (active) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          return {
            frames,
            stop: () => {
              active = false;
            },
          };
        }, id);
        await page.getByRole("button", { name: /Back to Library/ }).click();
        if (count === 3000 && position === 0.5) {
          await expect(collection).toBeVisible();
          await info.attach("revealed-collection.png", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        }
        await expect(target.locator("button").first()).toBeFocused();
        await page.locator(".library-content--books").evaluate(async (node) => {
          await Promise.all(node.getAnimations().map((animation) => animation.finished));
        });
        const trace = await target.evaluate(async (node) => {
          const frames: { scrollTop: number; y: number }[] = [];
          for (let frame = 0; frame < 12; frame++) {
            await new Promise(requestAnimationFrame);
            const root = node.closest(".page-shell")!;
            frames.push({
              scrollTop: root.scrollTop,
              y: node.getBoundingClientRect().top - root.getBoundingClientRect().top,
            });
          }
          return frames;
        });
        const pending = await recording.evaluate((recording) => {
          recording.stop();
          return recording.frames;
        });
        await info.attach("return-geometry.json", {
          body: JSON.stringify({
            id,
            y,
            trace,
            savedScrollTop,
            pending,
          }),
          contentType: "application/json",
        });
        if (savedScrollTop > 2) {
          const visible = pending.filter((frame) => frame.visible);
          expect(visible.length).toBeGreaterThan(0);
          expect(
            visible[0]!.scrollTop,
            "first visible Library frame must already have its return position",
          ).toBeGreaterThan(0);
          expect(
            visible.every((frame) => frame.scrollTop > 0),
            "no painted top-first return frame",
          ).toBe(true);
          expect(visible[0]!.y, "selected book must be retained before reveal").not.toBeNull();
          expect(
            Math.abs(visible[0]!.y! - visible[0]!.entranceY - y),
            "first visible anchor excluding deliberate entrance translation",
          ).toBeLessThanOrEqual(2);
        }
        expect(Math.abs(trace[0]!.y - y)).toBeLessThanOrEqual(2);
        expect(
          Math.max(...trace.map((frame) => frame.y)) - Math.min(...trace.map((frame) => frame.y)),
        ).toBeLessThanOrEqual(1);
        if (count === 500 && position === 0.5) {
          await page.setViewportSize({ width: 1000, height: 720 });
          await page.evaluate(() => {
            document.documentElement.dataset.density = "compact";
          });
          await expect
            .poll(async () =>
              target.evaluate(
                (node, expectedY) =>
                  Math.abs(
                    node.getBoundingClientRect().top -
                      node.closest(".page-shell")!.getBoundingClientRect().top -
                      expectedY,
                  ),
                y,
              ),
            )
            .toBeLessThanOrEqual(2);
          await expect(target.locator("button").first()).toBeFocused();
        }
      });
    }
  }
}

for (const view of ["grid", "list"] as const) {
  for (const intent of ["wheel", "pointerdown", "keydown", "touchstart"] as const) {
    test(`${view} cancels preparing return on ${intent}`, async ({ page }, info) => {
      await page.goto(
        `/tests/browser/fixtures/ui-stability.html?count=500&motion=off&view=${view}`,
        { waitUntil: "domcontentloaded" },
      );
      const collection = page.locator(view === "grid" ? ".book-grid" : ".book-list");
      await expect(collection).toBeVisible();
      await page.locator(".page-shell").evaluate((root) => {
        root.scrollTop = (root.scrollHeight - root.clientHeight) / 2;
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await collection.evaluate((root) => {
        const bounds = root.closest(".page-shell")!.getBoundingClientRect();
        const book = Array.from(root.querySelectorAll<HTMLElement>("[data-reader-book-id]")).find(
          (book) =>
            book.getBoundingClientRect().top >= bounds.top &&
            book.getBoundingClientRect().bottom <= bounds.bottom,
        )!;
        const button = book.querySelector<HTMLButtonElement>("button")!;
        button.focus({ preventScroll: true });
        button.click();
      });
      await page.getByRole("button", { name: "Read book", exact: true }).click();
      await expect(page.locator(".epub-container iframe").first()).toBeVisible();
      // Fault-inject unavailable row geometry, rather than extending a timing delay.
      await page.addStyleTag({
        content:
          ".collection-content__items[data-return-preparing] [data-reader-book-id] { height: 0 !important; overflow: hidden; }",
      });
      await page.getByRole("button", { name: /Back to Library/ }).click();
      await page.locator("[data-return-preparing]").waitFor({ state: "attached" });
      await page.locator(".page-shell").dispatchEvent(intent);
      await expect(page.locator("[data-return-preparing]")).toHaveCount(0);
      const trace = await page.locator(".page-shell").evaluate(async (root) => {
        const focus = document.activeElement;
        const frames: { scrollTop: number; sameFocus: boolean }[] = [];
        for (let frame = 0; frame < 16; frame++) {
          await new Promise(requestAnimationFrame);
          frames.push({ scrollTop: root.scrollTop, sameFocus: document.activeElement === focus });
        }
        return frames;
      });
      await info.attach("cancelled-return.json", {
        body: JSON.stringify(trace),
        contentType: "application/json",
      });
      expect(trace.every((frame) => frame.sameFocus)).toBe(true);
      expect(
        Math.max(...trace.map((frame) => frame.scrollTop)) -
          Math.min(...trace.map((frame) => frame.scrollTop)),
      ).toBeLessThanOrEqual(1);
    });
  }
}
