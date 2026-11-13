// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageShell } from "../../components/PageShell";
import { AppUpdateClient, type AppUpdateBackend } from "./appUpdateClient";
import type { AppUpdateSnapshot } from "./appUpdateTypes";
import { UpdateToast } from "./UpdateToast";

const external = vi.hoisted(() => ({ open: vi.fn<() => Promise<void>>() }));
vi.mock("../../app/openExternalUrl", () => ({ openExternalUrl: external.open }));

function snapshot(patch: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    revision: 1,
    supported: true,
    currentVersion: "1.6.0",
    status: "available",
    available: { version: "1.6.1", notes: null, publishedAt: null },
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    prompt: {
      snoozedVersion: null,
      snoozedUntil: null,
      restartDeferred: false,
      completedVersion: null,
    },
    ...patch,
  };
}
const sessions: { root: Root; container: HTMLElement }[] = [];
async function fixture(initial = snapshot()) {
  let update = initial;
  const listeners = new Set<(update: AppUpdateSnapshot) => void>();
  const emit = (patch: Partial<AppUpdateSnapshot>) => {
    update = { ...update, ...patch, revision: update.revision + 1 };
    listeners.forEach((listener) => listener(update));
    return update;
  };
  const backend = {
    isDesktop: () => true,
    read: async () => update,
    subscribe: async (listener: (update: AppUpdateSnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: vi.fn(async () => emit({ status: "available", error: null })),
    download: vi.fn(async () => emit({ status: "downloading", error: null })),
    install: vi.fn(async () => emit({ status: "installing", error: null })),
    defer: vi.fn(async () =>
      emit({
        prompt:
          update.status === "ready"
            ? { ...update.prompt, restartDeferred: true }
            : {
                ...update.prompt,
                snoozedVersion: update.available!.version,
                snoozedUntil: Date.now() + 86_400_000,
              },
      }),
    ),
    acknowledgeCompleted: vi.fn(async () => update),
  } satisfies AppUpdateBackend;
  const client = new AppUpdateClient(backend);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  sessions.push({ root, container });
  const render = (library = true) =>
    root.render(
      library ? (
        <PageShell sidebar={<aside>Sidebar</aside>} notice={<UpdateToast client={client} />}>
          <button>Library action</button>
        </PageShell>
      ) : (
        <main>
          <button>Reader action</button>
        </main>
      ),
    );
  await act(async () => {
    render();
    await client.initialize();
  });
  const button = (label: string) => {
    const element = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === label || element.getAttribute("aria-label") === label,
    );
    if (!element) throw new Error(`Missing button ${label}`);
    return element;
  };
  const click = async (label: string) => {
    await act(async () => {
      button(label).click();
    });
  };
  const change = async (patch: Partial<AppUpdateSnapshot>) => {
    await act(async () => {
      emit(patch);
    });
  };
  return { client, backend, container, root, render, button, click, change, emit };
}
afterEach(() => {
  for (const session of sessions.splice(0)) {
    act(() => session.root.unmount());
    session.container.remove();
  }
  vi.restoreAllMocks();
  external.open.mockReset();
  vi.useRealTimers();
});

describe("Library update notice", () => {
  it("keeps the failed release-notes action available for retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    external.open.mockRejectedValue(new Error("Browser unavailable"));
    const { container, backend } = await fixture(
      snapshot({
        status: "idle",
        currentVersion: "1.8.0",
        available: null,
        prompt: { ...snapshot().prompt, completedVersion: "1.8.0" },
      }),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".update-toast__release-button")?.click();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Archeion could not open that link. Try the link again.",
    );
    expect(container.querySelector(".update-toast__message")?.textContent).toBe(
      "Updated to Archeion 1.8.0",
    );
    expect(container.querySelector(".update-toast__release-button")).not.toBeNull();
    expect(backend.download).not.toHaveBeenCalled();
  });
  it("does not let a late failure update a notice unmounted for Reader", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, render, container } = await fixture();
    let reject!: (error: Error) => void;
    backend.download.mockImplementation(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    await click("Update now");
    await act(async () => {
      render(false);
      reject(new Error("Late transport failure"));
    });
    expect(container.textContent).toBe("Reader action");
    await act(async () => {
      render();
    });
    expect(container.textContent).toContain("Archeion 1.6.1 is available");
    expect(container.textContent).not.toContain("could not");
  });
  it("explicit dismissal does not pull focus back from a Library action during persistence", async () => {
    const { click, backend, button, container } = await fixture();
    let finish!: (update: AppUpdateSnapshot) => void;
    backend.defer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    button("Dismiss update notice").focus();
    await click("Dismiss update notice");
    button("Library action").focus();
    await act(async () => {
      finish(
        snapshot({
          revision: 2,
          prompt: {
            ...snapshot().prompt,
            snoozedVersion: "1.6.1",
            snoozedUntil: Date.now() + 1000,
          },
        }),
      );
    });
    expect(document.activeElement).toBe(button("Library action"));
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("renders the available notice in two rows with a dismiss control", async () => {
    const { container, backend, click } = await fixture();
    const toast = container.querySelector<HTMLElement>(".update-toast")!;
    expect(container.querySelector(".update-toast__message")?.textContent).toBe(
      "Archeion 1.6.1 is available",
    );
    expect(toast.querySelectorAll(":scope > .update-toast__header")).toHaveLength(1);
    expect(toast.querySelector(".update-toast__header .update-toast__actions")).toBeNull();
    expect(toast.querySelectorAll(":scope > .update-toast__actions")).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll(".update-toast button")).map(
        (button) => button.getAttribute("aria-label") ?? button.textContent,
      ),
    ).toEqual(["Dismiss update notice", "Update now"]);
    expect(container.querySelector(".update-toast a")).toBeNull();
    expect(container.textContent).not.toContain("What's new");
    expect(toast.querySelectorAll(".update-toast__actions .button--compact")).toHaveLength(1);
    expect(toast.querySelector(".update-toast__header .update-toast__dismiss svg")).not.toBeNull();
    expect(
      toast.querySelector(".update-toast__actions .button--primary .button__icon svg"),
    ).not.toBeNull();
    expect(container.querySelector("dialog")).toBeNull();
    expect(backend.check).not.toHaveBeenCalled();
    expect(backend.download).not.toHaveBeenCalled();
    await click("Update now");
    expect(backend.download).toHaveBeenCalledOnce();
    expect(backend.install).not.toHaveBeenCalled();
  });
  it("suppresses the exact snoozed version but presents a newer candidate", async () => {
    const { container, change } = await fixture(
      snapshot({
        prompt: { ...snapshot().prompt, snoozedVersion: "1.6.1", snoozedUntil: Date.now() + 1000 },
      }),
    );
    expect(container.querySelector(".update-toast")).toBeNull();
    await change({ available: { version: "1.6.2", notes: null, publishedAt: null } });
    expect(container.textContent).toContain("Archeion 1.6.2 is available");
  });
  it("shows an expired snooze on the next state evaluation", async () => {
    vi.useFakeTimers();
    const until = Date.now() + 1000;
    const { container, change } = await fixture(
      snapshot({ prompt: { ...snapshot().prompt, snoozedVersion: "1.6.1", snoozedUntil: until } }),
    );
    expect(container.querySelector(".update-toast")).toBeNull();
    vi.setSystemTime(until);
    await change({ status: "available" });
    expect(container.querySelector(".update-toast")).not.toBeNull();
  });
  it("dismiss uses native version-bound snooze and restores owned focus", async () => {
    vi.useFakeTimers();
    const { container, button, click, backend } = await fixture();
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container.querySelector(".update-toast")).not.toBeNull();
    button("Dismiss update notice").focus();
    await click("Dismiss update notice");
    expect(backend.defer).toHaveBeenCalledWith("1.6.1");
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("main"));
  });
  it.each([null, 0])("does not fabricate percent for unusable total %s", async (totalBytes) => {
    const { container } = await fixture(
      snapshot({ status: "downloading", downloadedBytes: 46, totalBytes }),
    );
    expect(container.textContent).toContain("Downloading…");
    expect(container.textContent).not.toContain("%");
    expect(container.querySelector("progress")?.hasAttribute("value")).toBe(false);
    expect(container.querySelectorAll(".update-toast button")).toHaveLength(0);
  });
  it("shows bounded determinate progress without repeated live-region chunk announcements", async () => {
    const { container, change } = await fixture(
      snapshot({ status: "downloading", downloadedBytes: 46, totalBytes: 100 }),
    );
    const toast = container.querySelector<HTMLElement>(".update-toast")!;
    expect(
      toast.querySelectorAll(":scope > .update-toast__header, :scope > progress"),
    ).toHaveLength(2);
    expect(container.querySelector("progress")?.value).toBe(46);
    expect(container.textContent).toContain("Downloading… 46%");
    const announcement = container.querySelector('[role="status"]')!.textContent;
    await change({ downloadedBytes: 150 });
    expect(container.querySelector("progress")?.value).toBe(100);
    expect(container.querySelector('[role="status"]')!.textContent).toBe(announcement);
  });
  it("ready keeps its restart message and native deferral across remounts", async () => {
    const { container, click, backend, render } = await fixture(snapshot({ status: "ready" }));
    expect(container.querySelector(".update-toast__message")?.textContent).toBe(
      "Restart Archeion to finish the update.",
    );
    expect(container.querySelector(".update-toast")?.textContent).not.toContain("1.6.1");
    expect(container.querySelector(".update-toast a")).toBeNull();
    expect(
      container.querySelector(".update-toast__actions .button--primary .button__icon svg"),
    ).not.toBeNull();
    await click("Dismiss update notice");
    expect(backend.defer).toHaveBeenCalledWith("1.6.1");
    expect(container.querySelector(".update-toast")).toBeNull();
    await act(async () => {
      render(false);
    });
    await act(async () => {
      render();
    });
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(backend.install).not.toHaveBeenCalled();
  });
  it("keeps explicit install single-flight while its request is pending", async () => {
    const { backend, button, container } = await fixture(snapshot({ status: "ready" }));
    let finish!: (update: AppUpdateSnapshot) => void;
    backend.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button("Restart now").click();
      button("Restart now").click();
    });
    expect(backend.install).toHaveBeenCalledOnce();
    expect(button("Restart now").disabled).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(".update-toast"));
    await act(async () => {
      finish(snapshot({ revision: 2, status: "installing" }));
    });
    expect(container.querySelector(".update-toast__message")?.textContent).toBe(
      "Restarting Archeion…",
    );
  });
  it("recovers a native download error with download retry and dismiss", async () => {
    const { click, backend, container } = await fixture(
      snapshot({
        error: { operation: "download", message: "The update could not be downloaded. Try again." },
      }),
    );
    expect(container.textContent).toContain("The update could not be downloaded.");
    await click("Try again");
    expect(backend.download).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Downloading…");
  });
  it("download-error dismiss snoozes the retained candidate", async () => {
    const { click, backend, container } = await fixture(
      snapshot({
        error: { operation: "download", message: "The update could not be downloaded. Try again." },
      }),
    );
    await click("Dismiss update notice");
    expect(backend.defer).toHaveBeenCalledWith("1.6.1");
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("install-error retry checks afresh instead of reusing consumed verified resources", async () => {
    const { click, backend } = await fixture(
      snapshot({
        status: "idle",
        available: null,
        error: {
          operation: "install",
          message: "The update could not be installed. Check for updates to try again.",
        },
      }),
    );
    await click("Try again");
    expect(backend.check).toHaveBeenCalledWith("manual");
    expect(backend.install).not.toHaveBeenCalled();
    expect(backend.download).not.toHaveBeenCalled();
  });
  it("install-error dismissal hides recovery without deferring", async () => {
    const { click, backend, container, change } = await fixture(
      snapshot({
        status: "idle",
        available: null,
        error: {
          operation: "install",
          message: "The update could not be installed. Check for updates to try again.",
        },
      }),
    );
    await click("Dismiss update notice");
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(backend.defer).not.toHaveBeenCalled();
    await change({ status: "available", available: snapshot().available, error: null });
    expect(container.textContent).toContain("Archeion 1.6.1 is available");
  });
  it("keeps retry and dismiss available after a failed recovery check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container, emit } = await fixture(
      snapshot({
        status: "idle",
        available: null,
        error: { operation: "install", message: "The update could not be installed. Try again." },
      }),
    );
    backend.check.mockImplementationOnce(async () => {
      emit({ status: "checking", error: null });
      emit({
        status: "idle",
        error: { operation: "check", message: "Updates could not be checked. Try again." },
      });
      throw new Error("Network unavailable");
    });
    await click("Try again");
    expect(container.textContent).toContain("Updates could not be checked. Try again.");
    await click("Dismiss update notice");
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(backend.defer).not.toHaveBeenCalled();
    expect(backend.install).not.toHaveBeenCalled();
  });
  it("replaces a failed recovery check with a newly discovered candidate on retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container, emit } = await fixture(
      snapshot({
        status: "idle",
        available: null,
        error: { operation: "install", message: "Installation failed. Try again." },
      }),
    );
    backend.check.mockImplementationOnce(async () => {
      emit({ status: "idle", error: { operation: "check", message: "Check failed" } });
      throw new Error("Network unavailable");
    });
    await click("Try again");
    backend.check.mockImplementationOnce(async () =>
      emit({ status: "available", available: snapshot().available, error: null }),
    );
    await click("Try again");
    expect(container.textContent).toContain("Archeion 1.6.1 is available");
    expect(container.textContent).not.toContain("could not");
    expect(backend.download).not.toHaveBeenCalled();
    expect(backend.install).not.toHaveBeenCalled();
  });
  it("does not restore a failed recovery check after a newer candidate supersedes it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container, change } = await fixture(
      snapshot({
        status: "idle",
        available: null,
        error: { operation: "install", message: "Installation failed. Try again." },
      }),
    );
    let reject!: (error: Error) => void;
    backend.check.mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    await click("Try again");
    await change({ status: "available", available: snapshot().available, error: null });
    await act(async () => {
      reject(new Error("Old failure"));
    });
    expect(container.textContent).toContain("Archeion 1.6.1 is available");
    expect(container.textContent).not.toContain("could not");
  });
  it("failed dismissal does not appear successful and can be retried", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container } = await fixture();
    backend.defer.mockRejectedValueOnce(new Error("Disk unavailable"));
    await click("Dismiss update notice");
    expect(container.textContent).toContain("The update could not be postponed. Try again.");
    await click("Try again");
    expect(backend.defer).toHaveBeenCalledTimes(2);
    expect(backend.download).not.toHaveBeenCalled();
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("surfaces installation preparation failure without discarding ready recovery", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container } = await fixture(snapshot({ status: "ready" }));
    backend.install.mockRejectedValueOnce(new Error("Marker write failed"));
    await click("Restart now");
    expect(container.textContent).toContain("The update could not be installed. Try again.");
    await click("Try again");
    expect(backend.install).toHaveBeenCalledTimes(2);
  });
  it("does not steal focus on discovery and maintains a stable polite region", async () => {
    const { button, container, change } = await fixture(
      snapshot({ status: "idle", available: null }),
    );
    const region = container.querySelector('[role="status"]');
    expect(region?.textContent).toBe("");
    button("Library action").focus();
    await change({ status: "available", available: snapshot().available });
    expect(document.activeElement).toBe(button("Library action"));
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("Archeion 1.6.1 is available");
  });
  it("retains native discovery through a Reader visit and does not create another check on Library return", async () => {
    const { container, render, change, backend } = await fixture(
      snapshot({ status: "idle", available: null }),
    );
    await act(async () => {
      render(false);
    });
    await change({ status: "available", available: snapshot().available });
    expect(container.querySelector(".update-toast")).toBeNull();
    await act(async () => {
      render();
    });
    expect(container.textContent).toContain("Archeion 1.6.1 is available");
    expect(backend.check).not.toHaveBeenCalled();
  });
  it.each([
    snapshot({ supported: false }),
    snapshot({ status: "idle", available: null }),
    snapshot({ status: "checking" }),
    snapshot({ status: "idle", error: { operation: "check", message: "Check failed" } }),
  ])(
    "does not present idle, checking, unsupported, or manual-check errors as an automatic toast",
    async (update) => {
      const { container } = await fixture(update);
      expect(container.querySelector(".update-toast")).toBeNull();
    },
  );
  it("opens release notes through the existing external-link owner", async () => {
    external.open.mockResolvedValue();
    const { container } = await fixture(
      snapshot({
        status: "idle",
        currentVersion: "1.8.0",
        available: null,
        prompt: { ...snapshot().prompt, completedVersion: "1.8.0" },
      }),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".update-toast__release-button")?.click();
    });
    expect(external.open).toHaveBeenCalledWith(
      "https://tommymoonn.github.io/archeion/documentation/changelog/#release-1-8-0",
    );
  });

  it("shows a dismissible two-row completion notice without a success icon", async () => {
    const { container, backend } = await fixture(
      snapshot({
        status: "idle",
        currentVersion: "1.8.0",
        available: null,
        prompt: { ...snapshot().prompt, completedVersion: "1.8.0" },
      }),
    );

    const toast = container.querySelector<HTMLElement>(".update-toast")!;
    expect(toast.dataset.state).toBe("completed");
    expect(toast.querySelector(".update-toast__message")?.textContent).toBe(
      "Updated to Archeion 1.8.0",
    );
    expect(toast.querySelector(".update-toast__release-button")?.textContent).toContain(
      "View release notes",
    );
    expect(toast.querySelector(".update-toast__status-icon")).toBeNull();
    expect(toast.querySelector(".update-toast__release-button svg")).not.toBeNull();
    expect(toast.querySelectorAll(":scope > .update-toast__header")).toHaveLength(1);
    expect(toast.querySelector(".update-toast__header .update-toast__actions")).toBeNull();
    expect(toast.querySelector(".update-toast__header .update-toast__dismiss")).not.toBeNull();
    expect(toast.querySelectorAll(":scope > .update-toast__actions")).toHaveLength(1);
    expect(
      toast.querySelector(".update-toast__actions .update-toast__release-button"),
    ).not.toBeNull();
    const dismiss = toast.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss update confirmation"]',
    );
    expect(dismiss).not.toBeNull();
    expect(dismiss?.querySelector("svg")).not.toBeNull();
    expect(backend.acknowledgeCompleted).toHaveBeenCalledWith("1.8.0");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Dismiss update confirmation"]')!
        .click();
    });
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("ignores late request failure after another candidate replaces the original", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, change, container } = await fixture();
    let reject!: (error: Error) => void;
    backend.download.mockImplementation(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    await click("Update now");
    await change({ available: { version: "1.6.2", notes: null, publishedAt: null } });
    await act(async () => {
      reject(new Error("Old failure"));
    });
    expect(container.textContent).toContain("Archeion 1.6.2 is available");
    expect(container.textContent).not.toContain("could not");
  });
});
