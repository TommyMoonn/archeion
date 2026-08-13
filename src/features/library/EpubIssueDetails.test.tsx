// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import type { EpubDiagnostics } from "../../types/epubIntegrity";
import { EpubIssueDetails } from "./EpubIssueDetails";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function renderDetails(issues: EpubDiagnostics["issues"]): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<EpubIssueDetails issues={issues} />));
  return container;
}

describe("EpubIssueDetails", () => {
  it("renders typed messages, severity, and EPUB-internal resource context", async () => {
    const rendered = await renderDetails([
      {
        code: "unsupported-reading-resource",
        messageInputs: { manifestId: "chapter-video", mediaType: "video/mp4" },
        resourcePath: "OPS/media/chapter.mp4",
        severity: "error",
      },
      {
        code: "broken-local-document-target",
        messageInputs: { href: "missing.xhtml#part" },
        resourcePath: "OPS/chapter.xhtml",
        severity: "warning",
      },
    ]);

    const issues = rendered.querySelectorAll<HTMLElement>(".epub-issue-detail");
    expect(issues).toHaveLength(2);
    expect(issues[0]?.textContent).toContain('Reading resource "chapter-video"');
    expect(issues[0]?.textContent).toContain("video/mp4");
    expect(issues[0]?.textContent).toContain("OPS/media/chapter.mp4");
    expect(issues[1]?.textContent).toContain("missing.xhtml#part");
    expect(issues[1]?.textContent).toContain("OPS/chapter.xhtml");
    expect(Array.from(issues, (issue) => issue.dataset.severity)).toEqual(["error", "warning"]);
  });
});
