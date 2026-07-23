// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useLibraryFeedback } from "./useLibraryFeedback";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type FeedbackController = ReturnType<typeof useLibraryFeedback>;

let activeRoot: Root | null = null;

function renderController(): { controller: () => FeedbackController; root: Root } {
  const container = document.createElement("div");
  const root = createRoot(container);
  let current: FeedbackController | null = null;

  function Harness() {
    current = useLibraryFeedback();
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    controller: () => {
      if (!current) throw new Error("Feedback controller was not rendered.");
      return current;
    },
    root,
  };
}

afterEach(() => {
  if (!activeRoot) return;
  act(() => activeRoot?.unmount());
  activeRoot = null;
});

describe("useLibraryFeedback operation ownership", () => {
  it("ignores an older completion after a newer operation reports an error", () => {
    const session = renderController();
    activeRoot = session.root;
    const older = session.controller().beginOperation("archive-scan");
    const newer = session.controller().beginOperation("archive-scan");

    act(() => {
      expect(
        session.controller().publishOperation(newer, {
          id: "archive-scan",
          tone: "error",
          title: "The archive could not be scanned.",
        }),
      ).toBe(true);
      expect(
        session.controller().publishOperation(older, {
          autoDismiss: true,
          id: "archive-scan",
          tone: "success",
          title: "Archive refreshed.",
        }),
      ).toBe(false);
    });

    expect(session.controller().tokens).toEqual([
      expect.objectContaining({
        tone: "error",
        title: "The archive could not be scanned.",
      }),
    ]);
  });

  it("deduplicates repeated identical updates within one operation", () => {
    const session = renderController();
    activeRoot = session.root;
    const operation = session.controller().beginOperation("archive-import");
    const feedback = {
      id: "archive-import",
      tone: "error" as const,
      title: "The EPUB files could not be added.",
    };

    act(() => {
      session.controller().publishOperation(operation, feedback);
    });
    const firstTokens = session.controller().tokens;
    act(() => {
      session.controller().publishOperation(operation, feedback);
    });

    expect(session.controller().tokens).toBe(firstTokens);
    expect(session.controller().tokens).toHaveLength(1);
  });

  it("prevents an older generic failure from replacing a newer error", () => {
    const session = renderController();
    activeRoot = session.root;
    const older = session.controller().beginOperation("library-error");

    act(() => {
      session.controller().showError("The newer operation failed.");
      expect(
        session.controller().publishOperation(older, {
          id: "library-error",
          tone: "error",
          title: "The older operation failed.",
        }),
      ).toBe(false);
    });

    expect(session.controller().tokens[0]?.title).toBe("The newer operation failed.");
  });
});
