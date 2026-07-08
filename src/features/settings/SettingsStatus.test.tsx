// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PERSISTENCE_SAVING_STATUS_DELAY_MS,
  SettingsStatus,
} from "./SettingsStatus";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsStatus", () => {
  it("renders local success messages as status updates", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus
        persistenceStatus={{ status: "idle" }}
        status={{ message: "Saved.", tone: "success" }}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-tone="success"');
    expect(markup).toContain("Saved.");
  });

  it("renders local error messages as alerts", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus
        persistenceStatus={{ status: "idle" }}
        status={{ message: "Failed.", tone: "error" }}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-tone="error"');
    expect(markup).toContain("Failed.");
  });

  it("renders persistence errors as alerts", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus
        persistenceStatus={{ status: "error", error: "Failed." }}
        status={null}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-tone="error"');
    expect(markup).toContain("Failed.");
  });

  it("renders nothing for a stale persistence saved state", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus persistenceStatus={{ status: "saved" }} status={null} />,
    );

    expect(markup).toBe("");
  });

  it("renders nothing when there is no local or persistence status", () => {
    const markup = renderToStaticMarkup(
      <SettingsStatus persistenceStatus={{ status: "idle" }} status={null} />,
    );

    expect(markup).toBe("");
  });
});

describe("SettingsStatus persistence saving delay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  function renderStatus(
    props: React.ComponentProps<typeof SettingsStatus>,
  ): void {
    act(() => {
      root.render(<SettingsStatus {...props} />);
    });
  }

  it("does not render persistence saving before the delay", () => {
    renderStatus({ persistenceStatus: { status: "saving" }, status: null });

    act(() => {
      vi.advanceTimersByTime(PERSISTENCE_SAVING_STATUS_DELAY_MS - 1);
    });

    expect(container.textContent).toBe("");
  });

  it("renders persistence saving after the delay", () => {
    renderStatus({ persistenceStatus: { status: "saving" }, status: null });

    act(() => {
      vi.advanceTimersByTime(PERSISTENCE_SAVING_STATUS_DELAY_MS);
    });

    expect(container.textContent).toContain("Saving settings.");
    expect(container.querySelector("[role='status']")).not.toBeNull();
    expect(container.querySelector("[data-tone='neutral']")).not.toBeNull();
  });

  it("cancels the saving timer if persistence becomes saved", () => {
    renderStatus({ persistenceStatus: { status: "saving" }, status: null });

    act(() => {
      vi.advanceTimersByTime(PERSISTENCE_SAVING_STATUS_DELAY_MS - 1);
    });
    renderStatus({ persistenceStatus: { status: "saved" }, status: null });
    act(() => {
      vi.advanceTimersByTime(PERSISTENCE_SAVING_STATUS_DELAY_MS);
    });

    expect(container.textContent).toBe("");
  });

  it("lets local status override persistence saving", () => {
    renderStatus({
      persistenceStatus: { status: "saving" },
      status: { message: "Reader settings reset.", tone: "success" },
    });

    act(() => {
      vi.advanceTimersByTime(PERSISTENCE_SAVING_STATUS_DELAY_MS);
    });

    expect(container.textContent).toContain("Reader settings reset.");
    expect(container.textContent).not.toContain("Saving settings.");
    expect(container.querySelector("[role='status']")).not.toBeNull();
    expect(container.querySelector("[data-tone='success']")).not.toBeNull();
  });
});
