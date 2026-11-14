import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Manifest } from "vite";

const manifest: Manifest = JSON.parse(
  readFileSync(
    new URL("../../.scratch/async-surfaces-build/.vite/manifest.json", import.meta.url),
    "utf8",
  ),
);
function builtChunk(name: string) {
  // Several shared chunks can have the same stem. Hold the authored module
  // entry from the actual build, rather than every similarly named chunk.
  const entries = Object.entries(manifest).filter(([source]) => source.endsWith(`/${name}.tsx`));
  if (entries.length !== 1)
    throw new Error(`Expected one built entry for ${name}; found ${entries.length}`);
  return `**/${entries[0][1].file}`;
}

const fixture = "/tests/browser/fixtures/async-surfaces.html";
const chunks = {
  add: "AddEpubDialog",
  rename: "RenameFileDialog",
  move: "MoveToFolderDialog",
  folder: "FolderCreateDialog",
  "folder-rename": "FolderRenameDialog",
  metadata: "BookAdvancedMetadataDialog",
  cover: "BookCoverWritebackDialog",
  bulk: "BulkMetadataDialog",
  details: "BookDetailsDrawer",
};

for (const surface of ["metadata", "cover"]) {
  for (const width of [1280, 390]) {
    test(`${surface}: dense form fades completely on workspace dismissal at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${fixture}?surface=${surface}&motion=on`);
      await page.getByRole("button", { name: "Open action" }).click();
      await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
      const samples = await page.locator(".dialog").evaluate((dialog) => {
        dialog.getAnimations({ subtree: true }).forEach((a) => a.finish());
        (window as unknown as { closeAsyncSurface: () => void }).closeAsyncSurface();
        const animations = dialog.getAnimations({ subtree: true });
        const panel = animations.find((a) => (a as CSSAnimation).animationName === "dialog-exit")!;
        const backdrop = animations.find(
          (a) => (a as CSSAnimation).animationName === "surface-backdrop-exit",
        )!;
        panel.pause();
        backdrop.pause();
        const duration = Number(panel.effect!.getTiming().duration);
        const frames = [0, 0.5, 1].map((fraction) => {
          panel.currentTime = fraction * duration;
          backdrop.currentTime = fraction * duration;
          return {
            bounds: dialog.getBoundingClientRect().toJSON(),
            opacity: Number(getComputedStyle(dialog).opacity),
            scrim: Number(getComputedStyle(dialog, "::backdrop").opacity),
            inert: (dialog.firstElementChild as HTMLElement).inert,
            modal: dialog.matches(":modal"),
          };
        });
        panel.finish();
        backdrop.finish();
        return { duration, frames };
      });
      await info.attach("dense-form-closing.json", {
        body: JSON.stringify(samples, null, 2),
        contentType: "application/json",
      });
      expect(samples.duration).toBe(120);
      expect(samples.frames.at(-1)!.opacity).toBeLessThanOrEqual(0.05);
      expect(samples.frames.at(-1)!.scrim).toBeLessThanOrEqual(0.05);
      for (const frame of samples.frames) {
        expect(frame.bounds).toEqual(samples.frames[0].bounds);
        expect(frame.inert && frame.modal).toBe(true);
      }
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open action" })).toBeFocused();
    });
  }
}

for (const surface of ["add", "rename", "metadata", "cover", "details"]) {
  test(`${surface}: native backdrop uses the shared dim without blur`, async ({ page }, info) => {
    await page.goto(`${fixture}?surface=${surface}&motion=on`);
    await page.getByRole("button", { name: "Open action" }).click();
    await expect(page.locator(".dialog-skeleton, .book-details-loading")).toHaveCount(0);
    const style = await page
      .locator("dialog[open]")
      .last()
      .evaluate((dialog) => {
        dialog.getAnimations({ subtree: true }).forEach((a) => a.finish());
        const backdrop = getComputedStyle(dialog, "::backdrop");
        const probe = document.createElement("div");
        probe.style.background = "var(--backdrop)";
        document.body.append(probe);
        const sharedColor = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          color: backdrop.backgroundColor,
          sharedColor,
          blur: backdrop.backdropFilter,
          opacity: backdrop.opacity,
          owner: dialog.getAttribute("data-backdrop-owner"),
          modal: dialog.matches(":modal"),
        };
      });
    await info.attach("backdrop.json", {
      body: JSON.stringify(style),
      contentType: "application/json",
    });
    expect(style.color).toBe(style.sharedColor);
    expect(style.blur).toBe("none");
    expect(style.opacity).toBe("1");
    expect(style.owner).toBe("true");
    expect(style.modal).toBe(true);
    await page.keyboard.press("Escape");
    // Cover and metadata return to Details through the existing route owner.
    if (surface === "cover" || surface === "metadata") await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open action" })).toBeFocused();
  });
}

for (const surface of ["rename", "add", "metadata", "cover"] as const) {
  test(`${surface}: readiness preserves the focused loading dismissal action`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(builtChunk(chunks[surface]), async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto(`${fixture}?surface=${surface}`);
      await page.getByRole("button", { name: "Open action" }).click();
      await expect(page.locator(".dialog-skeleton")).toHaveCount(1);
      const label = surface === "metadata" || surface === "cover" ? "Close" : "Cancel";
      const dismiss = page.getByRole("button", { name: label, exact: true });
      for (
        let step = 0;
        step < 6 && !(await dismiss.evaluate((el) => el === document.activeElement));
        step++
      ) {
        await page.keyboard.press("Tab");
      }
      await expect(dismiss).toBeFocused();
      const scroll = await page.locator(".dialog__body").evaluate((el) => el.scrollTop);
      release();
      await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
      await expect(dismiss).toBeFocused();
      expect(await page.locator(".dialog__body").evaluate((el) => el.scrollTop)).toBe(scroll);
      await page.keyboard.press("Enter");
      if (surface === "metadata" || surface === "cover") {
        await expect(page.getByRole("dialog")).toHaveAccessibleName("Example");
        await page.keyboard.press("Escape");
      }
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open action" })).toBeFocused();
    } finally {
      release();
    }
  });
}

for (const [surface, chunk] of Object.entries(chunks).filter(
  ([surface]) => surface !== "details",
)) {
  for (const viewport of [
    { width: 1100, height: 900 },
    { width: 480, height: 520 },
  ]) {
    test(`${surface}: skeleton preserves modal bounds ${viewport.width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize(viewport);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(builtChunk(chunk), async (route) => {
        await held;
        await route.continue();
      });
      try {
        await page.goto(`${fixture}?surface=${surface}`);
        await page.getByRole("button", { name: "Open action" }).click();
        await expect(page.locator(".dialog-skeleton")).toHaveCount(1);
        expect(
          await page
            .locator(".dialog-skeleton")
            .evaluate((element) => element.hasAttribute("inert")),
        ).toBe(true);
        const geometry = () =>
          page.locator("dialog").evaluate((dialog) => {
            const rect = (element: Element) => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            };
            return {
              outer: rect(dialog),
              header: rect(dialog.querySelector(".dialog__copy")!),
              footer: rect(dialog.querySelector(".dialog__footer")!),
              actions: [...dialog.querySelectorAll(".dialog__footer button")].map(rect),
            };
          });
        const before = await geometry();
        if (surface === "add" || surface === "folder-rename")
          await page.screenshot({ path: info.outputPath("modal-skeleton.png") });
        await page
          .locator("dialog")
          .evaluate((element) => element.setAttribute("data-frame-probe", "original"));
        release();
        await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
        await expect(page.locator("dialog")).toHaveAttribute("data-frame-probe", "original");
        expect(await geometry()).toEqual(before);
        const icons: Record<string, string> = {
          add: "plus",
          rename: "pencil",
          move: "move-right",
          folder: "folder-plus",
          "folder-rename": "save",
          metadata: "save",
          cover: "save",
          bulk: "list-checks",
        };
        await expect(page.locator(".dialog__footer button").last().locator("svg")).toHaveClass(
          new RegExp(`lucide-${icons[surface]}`),
        );
        if (surface === "add" || surface === "folder-rename")
          await page.screenshot({ path: info.outputPath("modal-ready.png") });
        expect(await page.locator(".dialog__footer .button").last().locator("svg").count()).toBe(1);
      } finally {
        release();
      }
    });
  }
}

for (const [surface, chunk] of Object.entries(chunks)) {
  test(`${surface}: cold shell, close before ready, and warm reopen`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route(builtChunk(chunk), async (route) => {
      requests++;
      await held;
      await route.continue();
    });
    try {
      await page.goto(`${fixture}?surface=${surface}`);
      expect(requests).toBe(0);
      await page.getByRole("button", { name: "Open action" }).click();
      await expect.poll(() => requests).toBe(1);
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      expect(await page.locator("dialog").evaluate((element) => element.matches(":modal"))).toBe(
        true,
      );
      if (surface !== "details") await expect(page.locator(".dialog__copy button")).toHaveCount(0);
      const loadingText = surface === "details" ? "Loading book details" : "Opening";
      await expect(page.getByRole("status")).toContainText(loadingText);
      await page.keyboard.press("Escape");
      // Metadata/cover return to details using the existing editor navigation owner.
      if (surface === "metadata" || surface === "cover") await page.keyboard.press("Escape");
      release();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await page.getByRole("button", { name: "Open action" }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await expect(page.getByRole("status").filter({ hasText: loadingText })).toHaveCount(0);
      if (surface === "rename" || surface === "folder" || surface === "folder-rename") {
        // The just-released import can still be pending on the first reopen. A committed ready
        // form establishes a warm module before checking its original field autofocus.
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        await page.getByRole("button", { name: "Open action" }).click();
        await expect(page.locator("[data-dialog-initial-focus]")).toBeFocused();
      }
      const rect = await page.locator("dialog").boundingBox();
      expect(rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    } finally {
      release();
    }
  });
}

test("Add EPUB retains natural completed geometry and no unnecessary body scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(`${fixture}?surface=add`);
  await page.getByRole("button", { name: "Open action" }).click();
  await expect(page.getByText("Operation", { exact: true })).toBeVisible();
  await expect(page.locator(".dialog__copy button")).toHaveCount(0);
  const hosted = await page.locator("dialog").boundingBox();
  expect(
    await page
      .locator(".dialog__body")
      .evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeLessThanOrEqual(1);
  await page.goto("/tests/browser/fixtures/dialog-geometry.html?surface=add-empty");
  await page.getByRole("button", { name: "Open dialog", exact: true }).click();
  expect(await page.locator("dialog").boundingBox()).toEqual(hosted);
});

test("late content cannot replace a newer modal or take its focus", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(builtChunk("RenameFileDialog"), async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto(`${fixture}?surface=rename`);
    await page.getByRole("button", { name: "Open action" }).click();
    await expect(page.getByRole("heading", { name: "Rename EPUB file" })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { replaceAsyncSurface: () => void }).replaceAsyncSurface();
    });
    const target = page.getByRole("button", { name: "Replacement target" });
    await target.focus();
    await expect(target).toBeFocused();
    release();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Replacement action");
    await expect(target).toBeFocused();
  } finally {
    release();
  }
});

for (const [surface, chunk] of [
  ["series", "SeriesOverview"],
  ["issues", "LibraryEpubIssuesView"],
  ["duplicates", "LibraryDuplicatesView"],
]) {
  test(`${surface}: shared header bounds through delayed delivery`, async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(builtChunk(chunk), async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page.goto(`${fixture}?surface=${surface}`);
      const header = page.locator(".library-header");
      await expect(header).toBeVisible();
      const before = await header.boundingBox();
      release();
      await expect(page.getByText("Opening view…", { exact: true })).toHaveCount(0);
      expect(await header.boundingBox()).toEqual(before);
    } finally {
      release();
    }
  });
}

for (const viewport of [
  { width: 579, height: 527 },
  { width: 480, height: 520 },
]) {
  test(`Add EPUB preserves existing small-window geometry ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${fixture}?surface=add`);
    await page.getByRole("button", { name: "Open action" }).click();
    await expect(page.getByText("Operation", { exact: true })).toBeAttached();
    const bounds = await page.locator("dialog").boundingBox();
    const overflow = await page
      .locator(".dialog__body")
      .evaluate((element) => element.scrollHeight - element.clientHeight);
    await page.goto("/tests/browser/fixtures/dialog-geometry.html?surface=add-empty");
    await page.getByRole("button", { name: "Open dialog", exact: true }).click();
    expect(await page.locator("dialog").boundingBox()).toEqual(bounds);
    expect(
      await page
        .locator(".dialog__body")
        .evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBe(overflow);
  });
}

for (const motion of ["app-off", "system-reduce"]) {
  test(`async action remains dismissible with ${motion}`, async ({ page }) => {
    await page.emulateMedia({
      reducedMotion: motion === "system-reduce" ? "reduce" : "no-preference",
    });
    await page.goto(`${fixture}?surface=rename&motion=${motion === "app-off" ? "off" : "on"}`);
    await page.getByRole("button", { name: "Open action" }).click();
    await expect(page.getByRole("textbox", { name: "Filename" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open action" })).toBeFocused();
  });
}

test("a failed chunk keeps an accessible retry and dismissal path", async ({ page }) => {
  let requests = 0;
  await page.route(builtChunk("RenameFileDialog"), async (route) => {
    requests++;
    if (requests === 1) await route.abort();
    else await route.continue();
  });
  await page.goto(`${fixture}?surface=rename`);
  await page.getByRole("button", { name: "Open action" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be opened");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("textbox", { name: "Filename" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog")).toHaveCount(0);
});

test("retry preserves keyboard dismissal intent through a delayed second import", async ({
  page,
}) => {
  let release!: () => void;
  let reject!: () => void;
  const failed = new Promise<void>((resolve) => {
    reject = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(builtChunk("RenameFileDialog"), async (route) => {
    requests++;
    if (requests === 1) {
      await failed;
      await route.abort();
    } else {
      await held;
      await route.continue();
    }
  });
  try {
    await page.goto(`${fixture}?surface=rename`);
    await page.getByRole("button", { name: "Open action" }).click();
    await expect(page.locator(".dialog-skeleton")).toHaveCount(1);
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    for (
      let step = 0;
      step < 6 && !(await cancel.evaluate((el) => el === document.activeElement));
      step++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(cancel).toBeFocused();
    reject();
    await expect(page.getByRole("alert")).toContainText("could not be opened");
    await expect(cancel).toBeFocused();
    const retry = page.getByRole("button", { name: "Try again" });
    await page.keyboard.press("Shift+Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".dialog-skeleton:visible")).toHaveCount(1);
    // Retry has no counterpart during loading; the heading is the intentional safe fallback.
    await expect(page.getByRole("heading", { name: "Rename EPUB file" })).toBeFocused();
    for (
      let step = 0;
      step < 6 && !(await cancel.evaluate((el) => el === document.activeElement));
      step++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(cancel).toBeFocused();
    release();
    await expect(page.locator(".dialog-skeleton")).toHaveCount(0);
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open action" })).toBeFocused();
  } finally {
    reject();
    release();
  }
});
