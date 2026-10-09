// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutSurface } from "../about/AboutSurface";
import { UpdateToast } from "./UpdateToast";
import { AppUpdateClient, type AppUpdateBackend } from "./appUpdateClient";
import type { AppUpdateSnapshot } from "./appUpdateTypes";
import { appPreferencesStore } from "../../stores/appPreferencesStore";

const owners = vi.hoisted(() => ({ client: null as AppUpdateClient | null, open: vi.fn() }));
vi.mock("./appUpdateClient", async (original) => ({
  ...(await original<typeof import("./appUpdateClient")>()),
  get appUpdateClient() {
    return owners.client;
  },
}));
vi.mock("../../app/openExternalUrl", () => ({ openExternalUrl: owners.open }));
const sessions: { root: Root; container: HTMLElement }[] = [];
function state(patch: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    revision: 1,
    supported: true,
    currentVersion: "1.6.1",
    status: "idle",
    available: null,
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
async function fixture(
  initial = state(),
  surface: "about" | "library" | "reader" | "both" = "about",
) {
  let current = initial;
  const listeners = new Set<(update: AppUpdateSnapshot) => void>();
  const emit = (patch: Partial<AppUpdateSnapshot>) => {
    current = { ...current, ...patch, revision: current.revision + 1 };
    listeners.forEach((listener) => listener(current));
    return current;
  };
  const backend = {
    isDesktop: () => true,
    read: vi.fn(async () => current),
    subscribe: async (listener: (update: AppUpdateSnapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: vi.fn(async () => emit({ status: "idle", available: null, error: null })),
    download: vi.fn(async () => emit({ status: "downloading", error: null })),
    install: vi.fn(async () => emit({ status: "installing", error: null })),
    defer: vi.fn(async () => emit({ prompt: { ...current.prompt, restartDeferred: true } })),
    acknowledgeCompleted: vi.fn(async () =>
      emit({ prompt: { ...current.prompt, completedVersion: null } }),
    ),
  } satisfies AppUpdateBackend;
  const client = new AppUpdateClient(backend);
  owners.client = client;
  owners.open.mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  sessions.push({ root, container });
  const render = (next = surface) =>
    root.render(
      next === "about" ? (
        <AboutSurface />
      ) : next === "both" ? (
        <>
          <AboutSurface />
          <UpdateToast client={client} />
        </>
      ) : next === "library" ? (
        <UpdateToast client={client} />
      ) : (
        <main>Reader</main>
      ),
    );
  await act(async () => {
    render();
    await client.initialize();
  });
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === label,
    );
    if (!button) throw new Error(`Missing action: ${label}`);
    await act(async () => {
      button.click();
    });
  };
  const change = async (patch: Partial<AppUpdateSnapshot>) => {
    await act(async () => {
      emit(patch);
    });
  };
  return { container, root, client, backend, emit, change, click, render };
}
afterEach(() => {
  sessions.splice(0).forEach(({ root, container }) => {
    act(() => root.unmount());
    container.remove();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  owners.open.mockReset();
});

describe("About update status", () => {
  it("offers a manual check and reports an explicit no-update result", async () => {
    const { click, container, backend } = await fixture();
    expect(container.textContent).not.toContain("Archeion is up to date.");
    await click("Check for updates");
    expect(backend.check).toHaveBeenCalledWith("manual");
    expect(container.textContent).toContain("Archeion is up to date.");
  });
  it("checks manually while automatic checks are disabled and the candidate is snoozed", async () => {
    const { click, backend, container, emit } = await fixture(
      state({
        prompt: { ...state().prompt, snoozedVersion: "1.6.2", snoozedUntil: Date.now() + 86400000 },
      }),
    );
    vi.spyOn(appPreferencesStore, "getSnapshot").mockReturnValue({
      ...appPreferencesStore.getSnapshot(),
      automaticallyCheckForUpdates: false,
    });
    expect(appPreferencesStore.getSnapshot().automaticallyCheckForUpdates).toBe(false);
    backend.check.mockImplementationOnce(async () =>
      emit({
        status: "available",
        available: { version: "1.6.2", notes: "Not embedded", publishedAt: null },
      }),
    );
    await click("Check for updates");
    expect(backend.check).toHaveBeenCalledWith("manual");
    expect(container.textContent).toContain("Archeion 1.6.2 is available");
    expect(container.textContent).not.toContain("Not embedded");
    expect(
      Array.from(container.querySelectorAll(".about-update button")).map(
        (button) => button.textContent,
      ),
    ).toEqual(["Update now"]);
  });
  it("replaces the manual check with Update now while an update is available", async () => {
    const { container, change, backend } = await fixture();
    const actions = () =>
      Array.from(container.querySelectorAll(".about-update button")).map(
        (button) => button.textContent,
      );
    expect(actions()).toEqual(["Check for updates"]);
    await change({
      status: "available",
      available: { version: "1.6.2", notes: null, publishedAt: null },
    });
    expect(actions()).toEqual(["Update now"]);
    await change({ status: "idle", available: null });
    expect(actions()).toEqual(["Check for updates"]);
    expect(backend.check).not.toHaveBeenCalled();
  });
  it("shows quiet disabled checking state and prevents duplicate requests", async () => {
    const { click, backend, container, emit } = await fixture();
    let finish!: (update: AppUpdateSnapshot) => void;
    backend.check.mockImplementationOnce(() => {
      emit({ status: "checking" });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await click("Check for updates");
    expect(container.textContent).toContain("Checking for updates…");
    const button = container.querySelector<HTMLButtonElement>(".about-update button")!;
    expect(button.disabled).toBe(true);
    await act(async () => {
      button.click();
    });
    expect(backend.check).toHaveBeenCalledOnce();
    await act(async () => {
      finish(emit({ status: "idle" }));
    });
    expect(container.textContent).toContain("Archeion is up to date.");
  });
  it("surfaces manual native check failure and permits another check", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container, emit } = await fixture();
    backend.check.mockImplementationOnce(async () => {
      emit({ error: { operation: "check", message: "Updates could not be checked. Try again." } });
      throw new Error("Network");
    });
    await click("Check for updates");
    expect(container.textContent).toContain("Updates could not be checked.");
    await click("Try again");
    expect(backend.check).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Archeion is up to date.");
  });
  it("shows request-only failure without a native revision and keeps technical text out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container } = await fixture();
    backend.check.mockRejectedValueOnce(new Error("Technical IPC detail"));
    await click("Check for updates");
    expect(container.textContent).toContain("Updates could not be checked. Try again.");
    expect(container.textContent).not.toContain("Technical IPC detail");
    await click("Try again");
    expect(container.textContent).toContain("Archeion is up to date.");
  });
  it("opens the same fixed Changelog root and candidate anchor through the external owner", async () => {
    const { container } = await fixture(
      state({
        status: "available",
        available: { version: "1.6.2", notes: null, publishedAt: null },
      }),
    );
    const changelog = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).find((link) =>
      link.textContent?.startsWith("Changelog"),
    )!;
    const release = container.querySelector<HTMLAnchorElement>(".about-update a")!;
    await act(async () => {
      changelog.click();
      release.click();
    });
    expect(changelog.href).toBe("https://tommymoonn.github.io/archeion/documentation/changelog/");
    expect(release.href).toBe(`${changelog.href}#release-1-6-2`);
    expect(owners.open.mock.calls).toEqual([[changelog.href], [release.href]]);
  });
  it("mirrors native changes in About and Library without launching a check on mount", async () => {
    const { container, backend, change } = await fixture(state(), "both");
    await change({
      status: "available",
      available: { version: "1.6.2", notes: null, publishedAt: null },
    });
    expect(container.querySelector(".about-update")?.textContent).toContain(
      "Archeion 1.6.2 is available",
    );
    expect(container.querySelector(".update-toast")?.textContent).toContain(
      "Archeion 1.6.2 is available",
    );
    await change({ status: "downloading", downloadedBytes: 20, totalBytes: 100 });
    expect(
      Array.from(container.querySelectorAll("progress")).map((progress) => progress.value),
    ).toEqual([20, 20]);
    await change({ status: "ready" });
    expect(container.querySelector(".about-update")?.textContent).toContain(
      "Restart Archeion to finish the update.",
    );
    expect(container.querySelector(".update-toast")?.textContent).toContain(
      "Restart Archeion to finish the update.",
    );
    expect(backend.check).not.toHaveBeenCalled();
  });
  it.each([null, 0, 100])(
    "renders truthful download progress with total %s",
    async (totalBytes) => {
      const { container } = await fixture(
        state({ status: "downloading", totalBytes, downloadedBytes: 140 }),
      );
      const progress = container.querySelector("progress")!;
      expect(progress.hasAttribute("value")).toBe(totalBytes !== null && totalBytes > 0);
      if (totalBytes) expect(progress.value).toBe(100);
      expect(container.querySelector(".about-update")?.querySelectorAll("button").length).toBe(0);
    },
  );
  it("offers Restart now even after session deferral and never reinstalls automatically", async () => {
    const { click, backend, container } = await fixture(
      state({ status: "ready", available: { version: "1.6.2", notes: null, publishedAt: null } }),
    );
    await click("Later");
    expect(backend.defer).toHaveBeenCalledWith("1.6.2");
    expect(container.textContent).toContain("Restart Archeion to finish the update.");
    expect(container.querySelector(".about-update a")).toBeNull();
    expect(backend.install).not.toHaveBeenCalled();
    await click("Restart now");
    expect(backend.install).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Restarting Archeion…");
  });
  it("retries a failed download, but rechecks after a consumed installation failure", async () => {
    const { click, backend, change } = await fixture(
      state({
        status: "available",
        available: { version: "1.6.2", notes: null, publishedAt: null },
        error: { operation: "download", message: "Download failed. Try again." },
      }),
    );
    await click("Try again");
    expect(backend.download).toHaveBeenCalledOnce();
    await change({
      status: "idle",
      available: null,
      error: { operation: "install", message: "Installation failed. Try again." },
    });
    await click("Try again");
    expect(backend.check).toHaveBeenCalledWith("manual");
    expect(backend.install).not.toHaveBeenCalled();
  });
  it("retains ready resources when installation preparation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { click, backend, container } = await fixture(
      state({ status: "ready", available: { version: "1.6.2", notes: null, publishedAt: null } }),
    );
    backend.install.mockRejectedValueOnce(new Error("Marker write failed"));
    await click("Restart now");
    expect(container.textContent).toContain("The update could not be installed. Try again.");
    await click("Try again");
    expect(backend.install).toHaveBeenCalledTimes(2);
  });
  it("ignores a delayed check result after a newer candidate replaces it", async () => {
    const { click, backend, container, change } = await fixture();
    let finish!: (update: AppUpdateSnapshot) => void;
    backend.check.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click("Check for updates");
    await change({
      revision: 5,
      status: "available",
      available: { version: "1.6.2", notes: null, publishedAt: null },
    });
    await act(async () => {
      finish(state({ revision: 2 }));
    });
    expect(container.textContent).toContain("Archeion 1.6.2 is available");
    expect(container.textContent).not.toContain("Archeion is up to date.");
  });
  it("keeps About branding and Changelog usable without a supported updater", async () => {
    const { container, backend } = await fixture(state({ supported: false }));
    expect(container.textContent).toContain("Updates are unavailable in this build.");
    expect(container.textContent).toContain("Changelog");
    expect(container.querySelector(".about-update button")).toBeNull();
    expect(backend.check).not.toHaveBeenCalled();
  });
});
describe("Updater completion notice", () => {
  it("shows and acknowledges only a matching native completion marker on a Library visit", async () => {
    const { container, backend } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "library",
    );
    expect(container.textContent).toContain("Archeion was updated to 1.6.1");
    expect(backend.acknowledgeCompleted).toHaveBeenCalledWith("1.6.1");
  });
  it.each([null, "1.6.0", "1.6.2"])(
    "does not infer completion from the executable version or mismatched marker %s",
    async (completedVersion) => {
      const { container, backend } = await fixture(
        state({ prompt: { ...state().prompt, completedVersion } }),
        "library",
      );
      expect(container.querySelector(".update-toast")).toBeNull();
      expect(backend.acknowledgeCompleted).not.toHaveBeenCalled();
    },
  );
  it("retains the marker at direct Reader startup, acknowledges on Library, and does not repeat on return", async () => {
    const { container, backend, render } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "reader",
    );
    expect(backend.acknowledgeCompleted).not.toHaveBeenCalled();
    await act(async () => {
      render("library");
    });
    expect(container.textContent).toContain("Archeion was updated to 1.6.1");
    await act(async () => {
      render("reader");
    });
    await act(async () => {
      render("library");
    });
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(backend.acknowledgeCompleted).toHaveBeenCalledOnce();
  });
  it("auto-dismisses after eight seconds of unpaused visible time", async () => {
    vi.useFakeTimers();
    const { container } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "library",
    );
    await act(async () => {
      vi.advanceTimersByTime(7999);
    });
    expect(container.querySelector(".update-toast")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("pauses independently for hover and keyboard focus, then resumes remaining time", async () => {
    vi.useFakeTimers();
    const { container } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "library",
    );
    const toast = container.querySelector<HTMLElement>(".update-toast")!;
    const link = toast.querySelector<HTMLAnchorElement>("a")!;
    await act(async () => {
      vi.advanceTimersByTime(3000);
      toast.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      link.focus();
      vi.advanceTimersByTime(20000);
    });
    expect(toast.isConnected).toBe(true);
    await act(async () => {
      toast.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      );
      vi.advanceTimersByTime(10000);
    });
    expect(toast.isConnected).toBe(true);
    await act(async () => {
      link.blur();
      vi.advanceTimersByTime(4999);
    });
    expect(toast.isConnected).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(toast.isConnected).toBe(false);
  });
  it("uses the shared completed-version release anchor without restart or download controls", async () => {
    const { container } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "library",
    );
    const link = container.querySelector<HTMLAnchorElement>("a")!;
    await act(async () => {
      link.click();
    });
    expect(owners.open).toHaveBeenCalledWith(
      "https://tommymoonn.github.io/archeion/documentation/changelog/#release-1-6-1",
    );
    expect(container.querySelector("button")).toBeNull();
  });
  it("gives actionable updates priority without consuming an unseen completion", async () => {
    const { container, backend, change } = await fixture(
      state({
        status: "available",
        available: { version: "1.6.2", notes: null, publishedAt: null },
        prompt: { ...state().prompt, completedVersion: "1.6.1" },
      }),
      "library",
    );
    expect(container.textContent).toContain("Archeion 1.6.2 is available");
    expect(backend.acknowledgeCompleted).not.toHaveBeenCalled();
    await change({ status: "idle", available: null });
    expect(container.textContent).toContain("Archeion was updated to 1.6.1");
    expect(backend.acknowledgeCompleted).toHaveBeenCalledOnce();
  });
  it("does not resurrect an already shown completion after a newer actionable notice", async () => {
    const { container, change } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "library",
    );
    await change({
      status: "available",
      available: { version: "1.6.2", notes: null, publishedAt: null },
    });
    await change({ status: "idle", available: null });
    expect(container.querySelector(".update-toast")).toBeNull();
  });
  it("does not duplicate acknowledgement under Strict Mode", async () => {
    const { root, client, backend } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "reader",
    );
    await act(async () => {
      root.render(
        <StrictMode>
          <UpdateToast client={client} />
        </StrictMode>,
      );
    });
    expect(backend.acknowledgeCompleted).toHaveBeenCalledOnce();
  });
  it("does not repeat the notice when Library remounts during a pending acknowledgement", async () => {
    const { container, backend, render, emit } = await fixture(
      state({ prompt: { ...state().prompt, completedVersion: "1.6.1" } }),
      "reader",
    );
    let finish!: (update: AppUpdateSnapshot) => void;
    backend.acknowledgeCompleted.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      render("library");
    });
    expect(container.textContent).toContain("Archeion was updated to 1.6.1");
    await act(async () => {
      render("reader");
    });
    await act(async () => {
      render("library");
    });
    expect(container.querySelector(".update-toast")).toBeNull();
    expect(backend.acknowledgeCompleted).toHaveBeenCalledOnce();
    await act(async () => {
      finish(emit({ prompt: state().prompt }));
    });
  });
});
