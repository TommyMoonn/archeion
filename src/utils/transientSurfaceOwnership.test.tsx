// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeTransientSurfaceKind,
  claimTransientSurfaceEscape,
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "./transientSurfaceOwnership";

afterEach(() => {
  resetTransientSurfaceOwnershipForTests();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function surface(label: string): HTMLElement {
  const element = document.createElement("div");
  element.dataset.label = label;
  document.body.append(element);
  return element;
}

describe("transient surface ownership", () => {
  it("claims Escape for only the topmost registered surface", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerTransientSurface({ element: surface("first"), kind: "reader-panel", onDismiss: first });
    registerTransientSurface({
      element: surface("second"),
      kind: "details-menu",
      onDismiss: second,
    });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");

    expect(claimTransientSurfaceEscape(event)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith("escape");
    expect(first).not.toHaveBeenCalled();
  });

  it("uses the same Escape claim contract from the installed window listener", () => {
    const onDismiss = vi.fn();
    registerTransientSurface({
      element: surface("menu"),
      kind: "details-menu",
      onDismiss,
    });
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Escape" });
    const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not claim an already prevented Escape", () => {
    const onDismiss = vi.fn();
    registerTransientSurface({ element: surface("menu"), kind: "popover", onDismiss });
    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Escape" });
    event.preventDefault();

    expect(claimTransientSurfaceEscape(event)).toBe(false);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("prunes disconnected surfaces before claiming Escape", () => {
    const connectedDismiss = vi.fn();
    const staleDismiss = vi.fn();
    registerTransientSurface({
      element: surface("connected"),
      kind: "reader-panel",
      onDismiss: connectedDismiss,
    });
    const stale = surface("stale");
    registerTransientSurface({ element: stale, kind: "popover", onDismiss: staleDismiss });
    stale.remove();

    const event = new KeyboardEvent("keydown", { cancelable: true, key: "Escape" });
    expect(claimTransientSurfaceEscape(event)).toBe(true);

    expect(connectedDismiss).toHaveBeenCalledOnce();
    expect(staleDismiss).not.toHaveBeenCalled();
  });

  it("dismisses only the topmost outside-pointer owner", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerTransientSurface({
      dismissOnOutsidePointer: true,
      element: surface("first"),
      kind: "details-menu",
      onDismiss: first,
    });
    registerTransientSurface({
      dismissOnOutsidePointer: true,
      element: surface("second"),
      kind: "popover",
      onDismiss: second,
    });

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(second).toHaveBeenCalledWith("outside-pointer");
    expect(first).not.toHaveBeenCalled();
  });

  it("window blur closes eligible non-modal surfaces without dismissing modals", () => {
    const menuDismiss = vi.fn();
    const panelDismiss = vi.fn();
    const modalDismiss = vi.fn();
    registerTransientSurface({
      element: surface("menu"),
      kind: "details-menu",
      onDismiss: menuDismiss,
    });
    registerTransientSurface({
      element: surface("panel"),
      kind: "reader-panel",
      onDismiss: panelDismiss,
    });
    registerTransientSurface({
      element: surface("modal"),
      kind: "app-dialog",
      modal: true,
      onDismiss: modalDismiss,
    });

    window.dispatchEvent(new Event("blur"));

    expect(menuDismiss).toHaveBeenCalledWith("window-blur");
    expect(panelDismiss).toHaveBeenCalledWith("window-blur");
    expect(modalDismiss).not.toHaveBeenCalled();
  });

  it("closes every connected incompatible surface when a modal opens", () => {
    const closeMenu = vi.fn();
    const closePopover = vi.fn();
    const keepPanel = vi.fn();
    registerTransientSurface({
      closeOnModalOpen: true,
      element: surface("menu"),
      kind: "context-menu",
      onDismiss: closeMenu,
    });
    registerTransientSurface({
      closeOnModalOpen: true,
      element: surface("popover"),
      kind: "popover",
      onDismiss: closePopover,
    });
    registerTransientSurface({
      element: surface("panel"),
      kind: "reader-panel",
      onDismiss: keepPanel,
    });

    registerTransientSurface({
      element: surface("dialog"),
      kind: "app-dialog",
      modal: true,
      onDismiss: vi.fn(),
    });

    expect(closeMenu).toHaveBeenCalledWith("modal-open");
    expect(closePopover).toHaveBeenCalledWith("modal-open");
    expect(keepPanel).not.toHaveBeenCalled();
    expect(activeTransientSurfaceKind()).toBe("app-dialog");
  });

  it("unregistration removes the active marker", () => {
    const element = surface("menu");
    const unregister = registerTransientSurface({
      element,
      kind: "details-menu",
      onDismiss: vi.fn(),
    });

    expect(element.dataset.applicationTransient).toBe("details-menu");
    unregister();

    expect(element.hasAttribute("data-application-transient")).toBe(false);
    expect(activeTransientSurfaceKind()).toBeNull();
  });

  it("shares one listener set across registrations and removes it after final cleanup", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const unregisterFirst = registerTransientSurface({
      element: surface("first"),
      kind: "details-menu",
      onDismiss: vi.fn(),
    });
    const unregisterSecond = registerTransientSurface({
      element: surface("second"),
      kind: "popover",
      onDismiss: vi.fn(),
    });

    expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);
    expect(addListener.mock.calls.filter(([type]) => type === "blur")).toHaveLength(1);

    unregisterFirst();
    expect(removeListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(0);
    unregisterSecond();

    expect(removeListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);
    expect(removeListener.mock.calls.filter(([type]) => type === "blur")).toHaveLength(1);
    expect(activeTransientSurfaceKind()).toBeNull();
  });
});
