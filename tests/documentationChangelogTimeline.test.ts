import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAllReleaseNotes } from "../scripts/release-notes.mjs";
import { syncDocumentationChangelog } from "../scripts/sync-documentation-changelog.mjs";
import {
  renderReleaseTimeline,
  syncDocumentationChangelogPage,
} from "../scripts/sync-documentation-changelog-page.mjs";

const targetPath = "docs/documentation/changelog/index.html";
const roots: string[] = [];
const windows: Window[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("archeion-timeline-")
    )
      throw new Error("Unsafe timeline fixture cleanup path.");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function documentFrom(html: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(html);
  return window.document;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-timeline-"));
  roots.push(root);
  for (const file of [
    targetPath,
    "docs/documentation/assets/docs-changelog-data.json",
    ".prettierrc.json",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(file, path.join(root, file));
  }
  fs.cpSync("release-notes", path.join(root, "release-notes"), { recursive: true });
  return root;
}

describe("static release timeline", () => {
  it("publishes every canonical release in order with native headings, dates and change lists", async () => {
    const before = fs.readFileSync(targetPath, "utf8");
    const document = documentFrom(before);
    const notes = readAllReleaseNotes(process.cwd());
    const releases = [...document.querySelectorAll(".changelog-timeline > li")];
    expect(releases).toHaveLength(notes.length);
    for (const [index, release] of releases.entries()) {
      const note = notes[index];
      expect(release.querySelector("h2")?.textContent).toBe(`v${note.version}`);
      expect(release.querySelector("h2")?.id).toBe(`release-${note.version.replaceAll(".", "-")}`);
      expect(release.querySelector("time")?.getAttribute("datetime")).toBe(note.date);
      expect(release.querySelector("time")?.textContent).toMatch(/\w+ \d{1,2}, \d{4}/);
      expect(release.querySelectorAll(".release-changes > ul > li").length).toBe(
        note.changes.match(/^- /gm)?.length,
      );
      expect(
        [...release.querySelectorAll(".release-changes > ul > li")].map((item) =>
          item.textContent.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(
        note.changes
          .split(/\r?\n/)
          .filter((line: string) => line.startsWith("- "))
          .map((line: string) =>
            line
              .slice(2)
              .replace(/\*\*([^*]+)\*\*/g, "$1")
              .replace(/`([^`]+)`/g, "$1"),
          ),
      );
      expect(release.querySelector(".release-notes-link")?.getAttribute("href")).toBe(
        `https://github.com/TommyMoonn/archeion/releases/tag/v${note.version}`,
      );
    }
    expect(
      document.querySelector('.changelog-timeline[aria-label="Releases, newest first"]'),
    ).not.toBeNull();
    expect(
      document.querySelector("h2#release-1-5-0")?.closest("li")?.querySelector("strong")
        ?.textContent,
    ).toBe("Narrow");
    expect(
      document.querySelector("h2#release-1-1-0")?.closest("li")?.querySelector("code")?.textContent,
    ).toBe("Ctrl+F");
    expect(await syncDocumentationChangelogPage()).toEqual({
      changed: false,
      entryCount: notes.length,
    });
    expect(fs.readFileSync(targetPath, "utf8")).toBe(before);
  });

  it("escapes prose and preserves supported inline formatting and safe links", () => {
    const document = documentFrom(
      renderReleaseTimeline([
        {
          version: "1.0.0",
          date: "2026-10-05",
          changes:
            "- Use **bold** and `Ctrl+F`, <script>alert(1)</script> & [help](https://example.com/help?q=1&x=2).\n  Continued prose.",
        },
      ]),
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("strong")?.textContent).toBe("bold");
    expect(document.querySelector("code")?.textContent).toBe("Ctrl+F");
    expect(document.querySelector('a[href^="https://example.com"]')?.getAttribute("href")).toBe(
      "https://example.com/help?q=1&x=2",
    );
    expect(document.querySelector(".release-changes li")?.textContent).toContain(
      "<script>alert(1)</script> & help. Continued prose.",
    );
    expect(() =>
      renderReleaseTimeline([
        { version: "1.0.0", date: "2026-10-05", changes: "- [unsafe](javascript:alert)" },
      ]),
    ).toThrow(/unsafe|HTTPS/i);
    expect(() =>
      renderReleaseTimeline([
        { version: "1.0.0", date: "2026-10-05", changes: "- Item\n\n## Unsupported" },
      ]),
    ).toThrow(/unsupported/i);
    expect(() =>
      renderReleaseTimeline([
        { version: "1.0.0", date: "2026-10-05", changes: "- Item\n  - Nested" },
      ]),
    ).toThrow(/unsupported/i);
  });

  it("detects source edits without writing and updates only its region after data sync", async () => {
    const root = fixture();
    const target = path.join(root, targetPath);
    const before = fs.readFileSync(target, "utf8");
    const note = path.join(root, "release-notes/v1.5.4.md");
    fs.writeFileSync(
      note,
      fs
        .readFileSync(note, "utf8")
        .replace("## Changes", "## Changes\n\n- Updated canonical prose."),
    );
    await expect(syncDocumentationChangelogPage(root, { check: false })).rejects.toThrow(
      /data.*stale|data.*drift/i,
    );
    expect(fs.readFileSync(target, "utf8")).toBe(before);
    await syncDocumentationChangelog(root, { check: false });
    expect(await syncDocumentationChangelogPage(root)).toEqual({ changed: true, entryCount: 24 });
    expect(fs.readFileSync(target, "utf8")).toBe(before);
    await syncDocumentationChangelogPage(root, { check: false });
    const after = fs.readFileSync(target, "utf8");
    expect(after).toContain("Updated canonical prose.");
    const outsideRegion = (html: string) =>
      html.replace(/<!-- docs-changelog:start -->[\s\S]*?<!-- docs-changelog:end -->/, "");
    expect(outsideRegion(after)).toBe(outsideRegion(before));
    expect(await syncDocumentationChangelogPage(root)).toEqual({ changed: false, entryCount: 24 });
    fs.writeFileSync(target, after.replace("docs-changelog:end", "missing-marker"));
    await expect(syncDocumentationChangelogPage(root, { check: false })).rejects.toThrow(/region/i);
  });

  it("adds and removes releases without leaving stale headings or hand-authored history", async () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, "release-notes/v1.5.5.md"),
      "<!-- release-note: v1.5.5; date: 2026-10-05 -->\n\n## Changes\n\n- New user-facing release.\n",
    );
    fs.rmSync(path.join(root, "release-notes/v0.1.0.md"));
    await syncDocumentationChangelog(root, { check: false });
    await syncDocumentationChangelogPage(root, { check: false });
    const document = documentFrom(fs.readFileSync(path.join(root, targetPath), "utf8"));
    expect(document.querySelector(".changelog-timeline h2")?.textContent).toBe("v1.5.5");
    expect(document.querySelector("#release-0-1-0")).toBeNull();
    expect(document.querySelector("#release-1-5-5")?.closest("li")?.textContent).toContain(
      "New user-facing release.",
    );
    expect(await syncDocumentationChangelogPage(root)).toEqual({ changed: false, entryCount: 24 });
  });

  it.each(["page", "data", "note"])(
    "rejects a concurrent %s edit before replacing the page",
    async (owner) => {
      const root = fixture();
      const target = path.join(root, targetPath);
      const edited =
        owner === "page"
          ? target
          : path.join(
              root,
              owner === "data"
                ? "docs/documentation/assets/docs-changelog-data.json"
                : "release-notes/v1.5.4.md",
            );
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace("September 25, 2026", "Stale date"),
      );
      const originalRead = fs.readFileSync;
      let scheduled = false;
      vi.spyOn(fs, "readFileSync").mockImplementation((file, options) => {
        const result = originalRead(file, options);
        if (String(file) === target && !scheduled) {
          scheduled = true;
          queueMicrotask(() => fs.appendFileSync(edited, "\n"));
        }
        return result;
      });
      await expect(syncDocumentationChangelogPage(root, { check: false })).rejects.toThrow(
        /changed during timeline sync/,
      );
      expect(fs.readFileSync(target, "utf8")).toContain("Stale date");
      expect(fs.readFileSync(edited, "utf8")).toMatch(/\n\n$/);
    },
  );

  it("CLI check detects timeline drift without writing and generation refuses unsupported prose", async () => {
    const root = fixture();
    const target = path.join(root, targetPath);
    const run = () =>
      spawnSync(
        process.execPath,
        [
          path.resolve("scripts/sync-documentation-changelog-page.mjs"),
          "--check",
          "--project",
          root,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    expect(run().status).toBe(0);
    fs.writeFileSync(
      target,
      fs.readFileSync(target, "utf8").replace("September 25, 2026", "Stale date"),
    );
    const before = fs.readFileSync(target, "utf8");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Documentation changelog timeline drift");
    expect(fs.readFileSync(target, "utf8")).toBe(before);
    const note = path.join(root, "release-notes/v1.5.4.md");
    fs.writeFileSync(
      note,
      fs.readFileSync(note, "utf8").replace("## Changes", "## Changes\n\nUnsupported paragraph."),
    );
    await syncDocumentationChangelog(root, { check: false });
    await expect(syncDocumentationChangelogPage(root, { check: false })).rejects.toThrow(
      /Unsupported/,
    );
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  });
});
