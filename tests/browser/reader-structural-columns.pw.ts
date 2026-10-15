import { expect, test, type Page } from "@playwright/test";
import { EpubCFI } from "epubjs";

async function settle(page: Page) {
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  let last = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const value = await page.evaluate(() =>
          JSON.stringify(
            [...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe")].map(
              (frame) => [
                frame.getBoundingClientRect().toJSON(),
                frame.contentDocument?.body?.getBoundingClientRect().toJSON(),
                window.readerInteractions.location(),
              ],
            ),
          ),
        );
        stable = value === last ? stable + 1 : 0;
        last = value;
        return stable;
      },
      { intervals: [100], timeout: 15000 },
    )
    .toBeGreaterThanOrEqual(3);
}

async function geometry(page: Page, title: string, ids: string[]) {
  return page.evaluate(
    ({ title, ids }) => {
      const frame = [
        ...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe"),
      ].find((frame) => frame.contentDocument?.title === title)!;
      const doc = frame.contentDocument!;
      const nodes = Object.fromEntries(
        ids.map((id) => {
          const node = doc.getElementById(id)!;
          const rect = node.getBoundingClientRect();
          const style = doc.defaultView!.getComputedStyle(node);
          return [
            id,
            {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              center: rect.x + rect.width / 2,
              marginStart: style.marginInlineStart,
              marginEnd: style.marginInlineEnd,
              textAlign: style.textAlign,
              textIndent: style.textIndent,
              direction: style.direction,
              float: style.cssFloat,
              columns: style.columnCount,
              computedWidth: style.width,
              fragments: [...node.getClientRects()].map((rect) => rect.toJSON()),
              prose: node.getAttribute("data-archeion-running-prose"),
              toc: node.getAttribute("data-archeion-toc-flow"),
              structural: node.getAttribute("data-archeion-structural-flow"),
            },
          ];
        }),
      );
      // Measure ch in the actual themed document rather than assuming glyph widths.
      const probe = doc.createElement("span");
      probe.style.cssText = "position:absolute;width:72ch;height:0";
      doc.body.appendChild(probe);
      const ch = probe.getBoundingClientRect().width / 72;
      probe.remove();
      return {
        nodes,
        ch,
        stage: document.querySelector(".epub-container")!.getBoundingClientRect().toJSON(),
        body: doc.body.getBoundingClientRect().toJSON(),
      };
    },
    { title, ids },
  );
}

async function open(page: Page, mode: "paged" | "continuous", stage = 1050) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/tests/browser/fixtures/reader-interactions.html");
  await expect.poll(() => page.evaluate(() => window.readerInteractions?.ready())).toBe(true);
  await page.locator("#root").evaluate((root, stage) => {
    root.style.width = `${stage}px`;
  }, stage);
  await page.evaluate((mode) => window.readerInteractions.open("structural-columns", mode), mode);
  await expect.poll(() => page.evaluate(() => window.readerInteractions.ready())).toBe(true);
  await settle(page);
}

async function visibleCfi(page: Page) {
  const candidates = await page.evaluate(() => {
    const candidates: string[] = [];
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe")) {
      for (const node of frame.contentDocument?.querySelectorAll(
        "h1[id], p[id], li[id], span[id]",
      ) ?? []) {
        const cfi = window.readerInteractions.cfi(node.id);
        candidates.push(cfi);
      }
    }
    return candidates;
  });
  // A whole-paragraph range can straddle two Paged columns. Check the actual
  // point, not the union rectangle that also includes an offscreen fragment.
  for (const candidate of candidates) {
    const parsed = new EpubCFI(candidate);
    parsed.collapse(true);
    const cfi = parsed.toString();
    if (await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, cfi))
      return cfi;
  }
  throw new Error("Expected an actually visible structural-fixture passage");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
});

for (const mode of ["continuous", "paged"] as const) {
  test(`structural policy reversal, RTL, navigation and note annotations in ${mode}`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    await open(page, mode);
    await page.evaluate(() => window.readerInteractions.navigate("structural-negatives"));
    for (const policy of ["publisher", "archeion"] as const) {
      await page.evaluate((policy) => window.readerInteractions.presentation(policy), policy);
      await settle(page);
      const negative = await geometry(page, "structural-negatives", [
        "ordinary-list",
        "bibliography",
        "fixed-legacy",
        "composed-proportional",
        "ordinary-aside",
        "composed-note",
        "column-note",
        "unrelated-rule",
      ]);
      await info.attach(`negative-${policy}`, {
        body: JSON.stringify(negative),
        contentType: "application/json",
      });
      for (const node of Object.values(negative.nodes)) {
        expect(node.toc).toBeNull();
        expect(node.structural).toBeNull();
      }
      expect(negative.nodes["fixed-legacy"].width).toBe(240);
      expect(parseFloat(negative.nodes["composed-proportional"].computedWidth)).toBe(240);
      for (const rect of negative.nodes["composed-proportional"].fragments)
        expect(rect.width).toBeLessThanOrEqual(241);
      expect(negative.nodes["composed-note"].float).toBe("right");
      expect(negative.nodes["column-note"].columns).toBe("2");
    }
    await page.evaluate(() => window.readerInteractions.navigate("legacy-rtl"));
    await settle(page);
    const rtl = await geometry(page, "legacy-rtl", ["rtl-legacy-list"]);
    expect(rtl.nodes["rtl-legacy-list"].toc).toBe("");
    expect(rtl.nodes["rtl-legacy-list"].direction).toBe("rtl");
    await info.attach("rtl", { body: JSON.stringify(rtl), contentType: "application/json" });

    await page.evaluate(() => window.readerInteractions.navigate("legacy-toc"));
    for (const fontFamily of ["serif", "literata"] as const) {
      await page.evaluate(
        (fontFamily) =>
          window.readerInteractions.settings({
            fontFamily: { kind: "builtin", id: fontFamily },
            fontSize: 22,
            readingWidth: "narrow",
          }),
        fontFamily,
      );
      await page.evaluate(async () => {
        await Promise.all(
          [...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe")].map(
            (frame) => frame.contentDocument?.fonts.ready,
          ),
        );
      });
      await settle(page);
      const sample = await geometry(page, "legacy-toc", ["legacy-title", "legacy-list"]);
      expect(sample.nodes["legacy-title"].width).toBeCloseTo(sample.nodes["legacy-list"].width, 0);
      expect(sample.nodes["legacy-list"].width).toBeCloseTo(sample.ch * 58, 0);
      await info.attach(`legacy-font-${fontFamily}`, {
        body: JSON.stringify(sample),
        contentType: "application/json",
      });
    }
    await page.evaluate(() =>
      window.readerInteractions.settings({
        fontFamily: { kind: "builtin", id: "serif" },
        fontSize: 18,
        readingWidth: "comfortable",
      }),
    );
    await settle(page);

    for (const [title, id] of [
      ["legacy-toc", "legacy-link"],
      ["note-chapter", "note-copy"],
      ["proportional-section", "proportional-first"],
    ]) {
      await page.evaluate((title) => window.readerInteractions.navigate(title), title);
      await settle(page);
      const cfi = await page.evaluate((id) => window.readerInteractions.cfi(id), id);
      await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), cfi);
      await settle(page);
      await page.evaluate(() => window.readerInteractions.presentation("publisher"));
      await settle(page);
      const publisher = await geometry(page, title, [id]);
      for (const policy of ["archeion", "publisher", "archeion"] as const) {
        const leading = await visibleCfi(page);
        const beforeSwitch = await page.evaluate(
          (cfi) => ({
            target: window.readerInteractions.passageAt(cfi),
            location: window.readerInteractions.location(),
            visible: window.readerInteractions.passage(),
          }),
          cfi,
        );
        await page.evaluate((policy) => window.readerInteractions.presentation(policy), policy);
        await settle(page);
        const sample = await geometry(page, title, [id]);
        await info.attach(`switch-${title}-${policy}`, {
          body: JSON.stringify({
            leading,
            beforeSwitch,
            sample,
            afterSwitch: await page.evaluate(
              (cfi) => ({
                target: window.readerInteractions.passageAt(cfi),
                location: window.readerInteractions.location(),
              }),
              cfi,
            ),
          }),
          contentType: "application/json",
        });
        if (policy === "publisher")
          expect(sample.nodes[id].width).toBeCloseTo(publisher.nodes[id].width, 0);
        expect(await page.evaluate((id) => window.readerInteractions.cfi(id), id)).toBe(cfi);
        await expect
          .poll(
            () =>
              page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, leading),
            { timeout: 10000 },
          )
          .toBe(true);
        if (policy === "publisher")
          expect(
            await page.evaluate(() =>
              [...document.querySelectorAll<HTMLIFrameElement>(".epub-container iframe")].reduce(
                (count, frame) =>
                  count +
                  (frame.contentDocument?.querySelectorAll(
                    "[data-archeion-toc-flow], [data-archeion-structural-flow]",
                  ).length ?? 0),
                0,
              ),
            ),
          ).toBe(0);
      }
    }
    await page.evaluate(() => window.readerInteractions.navigate("legacy-toc"));
    await settle(page);
    let frame = page.frames().find((frame) => frame.name().includes("epubjs"))!;
    for (const candidate of page.frames())
      if ((await candidate.title()) === "legacy-toc") frame = candidate;
    await frame.locator("#legacy-link").focus();
    await expect(frame.locator("#legacy-link")).toBeFocused();
    await page.keyboard.press("Enter");
    await settle(page);
    const chapterCfi = await page.evaluate(() => window.readerInteractions.cfi("note-anchor"));
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, chapterCfi),
    ).toBe(true);
    for (const candidate of page.frames())
      if ((await candidate.title()) === "note-chapter") frame = candidate;
    await frame.locator("#note-return").focus();
    await page.keyboard.press("Enter");
    await settle(page);
    const noteCfi = await page.evaluate(() => window.readerInteractions.cfi("note-copy"));
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, noteCfi),
    ).toBe(true);
    for (const candidate of page.frames())
      if ((await candidate.title()) === "note-chapter") frame = candidate;
    await frame.locator("#note-backlink").focus();
    await page.keyboard.press("Enter");
    await settle(page);
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, chapterCfi),
    ).toBe(true);
    await page.evaluate(() => window.readerInteractions.navigate("legacy-toc"));
    await settle(page);
    for (const candidate of page.frames())
      if ((await candidate.title()) === "legacy-toc") frame = candidate;
    await frame.locator("#legacy-long").click();
    await settle(page);
    const lateCfi = await page.evaluate(() => window.readerInteractions.cfi("note-late"));
    expect(
      await page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, lateCfi),
    ).toBe(true);
    const highlight = await page.evaluate(() =>
      window.readerInteractions.saveHighlight("note-copy"),
    );
    const bookmark = await page.evaluate(() => window.readerInteractions.bookmark("note-copy"));
    await page.evaluate(() => window.readerInteractions.navigate("column-tail-40"));
    await settle(page);
    expect(
      await page.evaluate(
        (bookmark) => window.readerInteractions.followBookmark(bookmark),
        bookmark,
      ),
    ).toBe(true);
    await settle(page);
    await info.attach("before-mode", {
      body: JSON.stringify(
        await page.evaluate(
          (cfi) => ({
            target: window.readerInteractions.passageAt(cfi),
            location: window.readerInteractions.location(),
            visible: window.readerInteractions.passage(),
          }),
          highlight.cfiRange,
        ),
      ),
      contentType: "application/json",
    });
    expect(await page.evaluate(() => window.readerInteractions.cfi("note-copy"))).toBe(
      highlight.cfiRange,
    );
    const leadingCfi = await visibleCfi(page);
    await page.evaluate(
      (mode) =>
        window.readerInteractions.settings({ mode: mode === "paged" ? "continuous" : "paged" }),
      mode,
    );
    await settle(page);
    await info.attach("after-mode", {
      body: JSON.stringify(
        await page.evaluate(
          (cfi) => ({
            target: window.readerInteractions.passageAt(cfi),
            location: window.readerInteractions.location(),
          }),
          highlight.cfiRange,
        ),
      ),
      contentType: "application/json",
    });
    await expect
      .poll(
        () => page.evaluate((cfi) => window.readerInteractions.passageAt(cfi)?.visible, leadingCfi),
        { timeout: 10000 },
      )
      .toBe(true);
    expect(await page.evaluate(() => window.readerInteractions.cfi("note-copy"))).toBe(
      highlight.cfiRange,
    );
    expect(
      await page.evaluate(
        (bookmark) => window.readerInteractions.followBookmark(bookmark),
        bookmark,
      ),
    ).toBe(true);
    await settle(page);
    expect(
      await page.evaluate(
        (cfi) => window.readerInteractions.passageAt(cfi)?.visible,
        highlight.cfiRange,
      ),
    ).toBe(true);
    await expect(page.locator(".archeion-highlight")).toHaveCount(1);
    await info.attach("annotation", {
      body: JSON.stringify({ highlight, bookmark }),
      contentType: "application/json",
    });
    expect(await page.evaluate(() => window.readerInteractions.errors())).toEqual([]);
  });
  for (const stage of [900, 1050, 1400]) {
    for (const category of ["legacy", "note", "proportional"] as const) {
      test(`${category} reading measure in ${mode} at ${stage}px`, async ({ page }, info) => {
        test.setTimeout(90000);
        await open(page, mode, stage);
        const title = {
          legacy: "legacy-toc",
          note: "note-chapter",
          proportional: "proportional-section",
        }[category];
        await page.evaluate((title) => window.readerInteractions.navigate(title), title);
        for (const width of ["narrow", "comfortable", "wide", "full"] as const) {
          await page.evaluate(
            (readingWidth) => window.readerInteractions.settings({ readingWidth }),
            width,
          );
          await settle(page);
          const ids = {
            legacy: ["legacy-title", "legacy-list", "legacy-nested", "legacy-link", "legacy-long"],
            note: ["note-anchor", "linked-note", "note-text", "note-separator"],
            proportional: [
              "proportional-root",
              "proportional-header",
              "proportional-first",
              "proportional-second",
            ],
          }[category];
          const sample = await geometry(page, title, ids);
          await info.attach(`${category}-${width}`, {
            body: JSON.stringify(sample),
            contentType: "application/json",
          });
          const cap = sample.ch * { narrow: 58, comfortable: 72, wide: 90, full: Infinity }[width];
          const root =
            sample.nodes[
              { legacy: "legacy-list", note: "linked-note", proportional: "proportional-root" }[
                category
              ]
            ];
          expect(root.width).toBeLessThanOrEqual(cap + 1);
          const axis = sample.body.x + sample.body.width / 2;
          const normalized =
            mode === "paged"
              ? root.center -
                Math.round((root.center - axis) / sample.stage.width) * sample.stage.width
              : root.center;
          expect(Math.abs(normalized - axis)).toBeLessThanOrEqual(1);
          if (category === "legacy") {
            expect(root.toc).toBe("");
            expect(root.width).toBeCloseTo(sample.nodes["legacy-title"].width, 0);
            expect(Math.abs(root.center - sample.nodes["legacy-title"].center)).toBeLessThanOrEqual(
              1,
            );
            expect(sample.nodes["legacy-nested"].x).toBeGreaterThan(root.x);
            expect(sample.nodes["legacy-link"].textIndent).toBe("-36px");
          } else if (category === "note") {
            expect(root.width).toBeCloseTo(sample.nodes["note-anchor"].width, 0);
            expect(sample.nodes["note-separator"].width).toBeCloseTo(root.width, 0);
            expect(sample.nodes["note-text"].prose).toBeNull();
            expect(sample.nodes["note-text"].textIndent).toBe("18px");
          } else {
            for (const id of ["proportional-first", "proportional-second"]) {
              expect(sample.nodes[id].width / root.width).toBeCloseTo(0.75, 2);
              expect(Math.abs(sample.nodes[id].center - root.center)).toBeLessThanOrEqual(1);
              expect(sample.nodes[id].prose).toBeNull();
              expect(sample.nodes[id].textAlign).toBe("justify");
            }
          }
          if (width === "comfortable") {
            if (category === "note") {
              const cfi = await page.evaluate(() => window.readerInteractions.cfi("note-copy"));
              await page.evaluate((cfi) => window.readerInteractions.navigate(cfi), cfi);
              await settle(page);
            }
            await page.screenshot({ path: info.outputPath(`${category}.png`) });
          }
        }
      });
    }
  }
}
