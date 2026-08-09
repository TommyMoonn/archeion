// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "../../components/Dialog";
import type { KeyboardPreferences } from "../../types/keyboard";
import { defaultReaderSettings, type ReaderSettings } from "../../types/reader";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import {
  activeTransientSurfaceKind,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import type { AppCommand } from "../commands/appCommands";
import { resolveKeyboardCommand } from "../commands/commandResolver";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";
import { ReaderSettingsPanel } from "./ReaderSettingsPanel";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const keyboardPreferences: KeyboardPreferences = { shortcuts: {} };

const basePanelProps = {
  onReaderThemeCommit: vi.fn(),
  onReaderThemeOpen: vi.fn(),
  onSettingsCommit: vi.fn(),
  persistenceFailed: false,
  readerThemeCatalogError: null,
  readerThemeEntries: [],
  readerThemeSelection: { kind: "builtin", id: "dark" } as const,
  settings: { ...defaultReaderSettings },
};

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  resetTransientSurfaceOwnershipForTests();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  root = null;
  container = null;
});

function createContainer() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return container;
}

function renderPanel(persistenceFailed = false) {
  const host = createContainer();
  const onClose = vi.fn();
  const onReaderThemeCommit = vi.fn();

  act(() => {
    root?.render(
      <ReaderSideSurfaceLayer onDismiss={onClose}>
        <ReaderSettingsPanel
          {...basePanelProps}
          onClose={onClose}
          onReaderThemeCommit={onReaderThemeCommit}
          persistenceFailed={persistenceFailed}
        />
      </ReaderSideSurfaceLayer>,
    );
  });

  return { container: host, onClose, onReaderThemeCommit };
}

function ControlledPanel({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <ReaderSideSurfaceLayer
      onDismiss={() => {
        onClose();
        setOpen(false);
      }}
    >
      <ReaderSettingsPanel
        {...basePanelProps}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </ReaderSideSurfaceLayer>
  ) : null;
}

function PanelWithModal({
  onModalClose,
  onPanelClose,
}: {
  onModalClose: () => void;
  onPanelClose: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      {panelOpen ? (
        <ReaderSideSurfaceLayer
          onDismiss={() => {
            onPanelClose();
            setPanelOpen(false);
          }}
        >
          <ReaderSettingsPanel
            {...basePanelProps}
            onClose={() => {
              onPanelClose();
              setPanelOpen(false);
            }}
          />
        </ReaderSideSurfaceLayer>
      ) : null}
      <button onClick={() => setModalOpen(true)} type="button">
        Open modal
      </button>
      {modalOpen ? (
        <Dialog
          onClose={() => {
            onModalClose();
            setModalOpen(false);
          }}
          title="Reader modal"
        >
          <button type="button">Modal action</button>
        </Dialog>
      ) : null}
    </>
  );
}

function mountedFrame(): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.defineProperty(frame.contentWindow, "frameElement", {
    configurable: true,
    value: frame,
  });
  return frame;
}

function command(id: string, scope: AppCommand["scope"]): AppCommand {
  return {
    configuration: "configurable",
    defaultBinding: { alt: false, key: "k", primary: true, shift: false },
    execute: vi.fn(),
    group: "Reader",
    id,
    label: id,
    scope,
  };
}

function keyboardEvent(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "k",
  });
  target.dispatchEvent(event);
  return event;
}

describe("ReaderSettingsPanel", () => {
  it("focuses the close control when the panel opens", () => {
    const rendered = renderPanel();
    const close = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close reader settings"]',
    );

    expect(rendered.container.querySelector(".reader-side-panel.reader-settings")).not.toBeNull();
    expect(rendered.container.querySelector(".reader-side-panel__header")?.textContent).toContain(
      "Appearance",
    );
    expect(document.activeElement).toBe(close);
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      "Saved automatically",
    );
  });

  it("announces persistence failures as an alert", () => {
    const rendered = renderPanel(true);

    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Settings could not be saved",
    );
  });

  it("keeps appearance-save feedback authoritative over background theme refresh feedback", () => {
    const host = createContainer();

    act(() => {
      root?.render(
        <ReaderSettingsPanel
          {...basePanelProps}
          onClose={vi.fn()}
          persistenceFailed
          readerThemeCatalogError="Themes were refreshed, but the active appearance could not be updated."
        />,
      );
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Settings could not be saved",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain(
      "Themes were refreshed",
    );
  });

  it("uses the shared archive reader-theme selection", () => {
    const rendered = renderPanel();
    const select = rendered.container.querySelector<HTMLButtonElement>('[role="combobox"]')!;

    act(() => select.click());
    const sepia = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Sepia",
    )!;
    act(() => sepia.click());

    expect(rendered.onReaderThemeCommit).toHaveBeenCalledWith({ kind: "builtin", id: "sepia" });
    expect(rendered.onClose).not.toHaveBeenCalled();
    expect(rendered.container.textContent?.match(/Reader theme/g)).toHaveLength(1);
  });

  it("requests freshness on reader-theme entry and preserves the open selection while options update", () => {
    const host = createContainer();
    const onReaderThemeOpen = vi.fn();
    const render = (
      entries: readonly ThemeCatalogEntry[] = basePanelProps.readerThemeEntries,
      readerThemeCatalogError: string | null = null,
    ) => {
      act(() => {
        root?.render(
          <ReaderSettingsPanel
            {...basePanelProps}
            onClose={vi.fn()}
            onReaderThemeOpen={onReaderThemeOpen}
            readerThemeCatalogError={readerThemeCatalogError}
            readerThemeEntries={entries}
          />,
        );
      });
    };
    render();
    const select = host.querySelector<HTMLButtonElement>('button[aria-label="Reader theme"]')!;

    act(() => select.click());
    expect(onReaderThemeOpen).toHaveBeenCalledOnce();
    expect(select.getAttribute("aria-expanded")).toBe("true");

    render([
      {
        applicable: true,
        capabilities: { application: true, reader: true },
        diagnostics: [],
        id: "moon-ink",
        manifest: {
          app: { accent: "#8fc1e3" },
          base: "dark",
          id: "moon-ink",
          name: "Moon Ink",
          reader: { base: "sepia", link: "#765b34" },
          schemaVersion: 1,
        },
        name: "Moon Ink",
        origin: "custom",
        packageId: "moon-ink",
        status: "valid",
      },
    ]);

    expect(select.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("Moon Ink");
    expect(select.textContent).toContain("Dark");

    render([], "Themes could not be refreshed. Reload themes to try again.");
    expect(select.getAttribute("aria-expanded")).toBe("true");
    expect(select.textContent).toContain("Dark");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Themes could not be refreshed",
    );
  });

  it("associates each visible setting label with its control group", () => {
    const rendered = renderPanel();
    const groups = [...rendered.container.querySelectorAll<HTMLElement>(".reader-setting")];

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.getAttribute("role")).toBe("group");
      const labelId = group.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId!)?.textContent?.trim()).not.toBe("");
    }
  });

  it("registers the rendered aside as one reader-panel and removes ownership on unmount", () => {
    const rendered = renderPanel();
    const panel = rendered.container.querySelector<HTMLElement>(
      'aside[aria-label="Reader settings"]',
    )!;

    const layer = rendered.container.querySelector<HTMLElement>(".reader-side-surface-layer")!;
    expect(panel.dataset.applicationTransient).toBeUndefined();
    expect(layer.dataset.applicationTransient).toBe("reader-panel");
    expect(activeTransientSurfaceKind()).toBe("reader-panel");

    act(() => root?.unmount());
    root = null;

    expect(layer.dataset.applicationTransient).toBeUndefined();
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("does not duplicate ownership or global listeners when settings values rerender", () => {
    createContainer();
    const onClose = vi.fn();
    const addEventListener = vi.spyOn(window, "addEventListener");

    function render(settings: ReaderSettings) {
      act(() => {
        root?.render(
          <ReaderSideSurfaceLayer onDismiss={onClose}>
            <ReaderSettingsPanel {...basePanelProps} onClose={onClose} settings={settings} />
          </ReaderSideSurfaceLayer>,
        );
      });
    }

    render({ ...defaultReaderSettings });
    render({ ...defaultReaderSettings, fontSize: defaultReaderSettings.fontSize + 1 });

    expect(
      addEventListener.mock.calls.filter(
        ([type, , options]) => type === "keydown" && options === true,
      ),
    ).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("claims parent-document Escape once before lower reader handling", () => {
    const host = createContainer();
    const onClose = vi.fn();
    act(() => root?.render(<ControlledPanel onClose={onClose} />));
    const lowerReaderClose = vi.fn();
    window.addEventListener("keydown", lowerReaderClose, true);
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Escape" });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(lowerReaderClose).not.toHaveBeenCalled();
    expect(host.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
    expect(activeTransientSurfaceKind()).toBeNull();
    window.removeEventListener("keydown", lowerReaderClose, true);
  });

  it("claims EPUB-document Escape before reader-local fallbacks", () => {
    const host = createContainer();
    const onClose = vi.fn();
    act(() => root?.render(<ControlledPanel onClose={onClose} />));
    const frame = mountedFrame();
    const chapter = frame.contentDocument!;
    const onEscape = vi.fn(() => true);
    const onContentKeyDown = vi.fn(() => true);
    const onKeyDown = vi.fn();
    const registry = new ReaderContentDocumentRegistry();
    registry.updateOptions({ onContentKeyDown, onEscape, onKeyDown });
    registry.bind({ document: chapter, window: frame.contentWindow! });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    act(() => chapter.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onEscape).not.toHaveBeenCalled();
    expect(onContentKeyDown).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(host.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("lets an AppSelect own the first Escape before Reader Settings", () => {
    const host = createContainer();
    const onClose = vi.fn();
    act(() => root?.render(<ControlledPanel onClose={onClose} />));
    const typeface = host.querySelector<HTMLButtonElement>('button[aria-label="Reader typeface"]')!;

    act(() => typeface.click());
    expect(activeTransientSurfaceKind()).toBe("popover");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(typeface.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('aside[aria-label="Reader settings"]')).not.toBeNull();
    expect(activeTransientSurfaceKind()).toBe("reader-panel");
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(host.querySelector('aside[aria-label="Reader settings"]')).toBeNull();
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("remains registered beneath a modal and closes after the modal is dismissed", () => {
    const host = createContainer();
    const onPanelClose = vi.fn();
    const onModalClose = vi.fn();
    act(() =>
      root?.render(<PanelWithModal onModalClose={onModalClose} onPanelClose={onPanelClose} />),
    );

    const openModal = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Open modal",
    )!;
    act(() => openModal.click());

    expect(activeTransientSurfaceKind()).toBe("app-dialog");
    expect(host.querySelector('aside[aria-label="Reader settings"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(onModalClose).toHaveBeenCalledOnce();
    expect(onPanelClose).not.toHaveBeenCalled();
    expect(activeTransientSurfaceKind()).toBe("reader-panel");
    expect(host.querySelector('aside[aria-label="Reader settings"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(onPanelClose).toHaveBeenCalledOnce();
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("uses the same resolver scope contract as the other reader panels", () => {
    renderPanel();
    const epubDocument = document.implementation.createHTMLDocument("EPUB");
    const target = epubDocument.createElement("p");
    epubDocument.body.append(target);
    const interactionContext = {
      applicationDocument: document,
      platform: "windows-linux" as const,
      sourceDocument: epubDocument,
    };

    expect(
      resolveKeyboardCommand(
        keyboardEvent(target),
        [command("reader.command", "reader")],
        keyboardPreferences,
        interactionContext,
      )?.command.id,
    ).toBe("reader.command");

    for (const scope of ["global", "library", "folders", "settings"] as const) {
      expect(
        resolveKeyboardCommand(
          keyboardEvent(target),
          [command(`${scope}.command`, scope)],
          keyboardPreferences,
          interactionContext,
        ),
      ).toBeNull();
    }
  });
});
