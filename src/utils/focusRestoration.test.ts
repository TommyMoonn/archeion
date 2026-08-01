// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  captureFocusReturn,
  claimFocusReturnSurface,
  currentFocusOrigin,
  focusCapturedReturn,
  focusElementIfRestorationOwned,
  focusElementIfUsable,
  focusIsUnowned,
  isUsableFocusTarget,
  resolveFocusRestorationIntent,
} from "./focusRestoration";
import { focusPresentationRuntime } from "../app/inputModality";
import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "./transientSurfaceOwnership";

afterEach(() => {
  resetTransientSurfaceOwnershipForTests();
  document.body.innerHTML = "";
});

function embeddedButton(parentDocument: Document = document): {
  frame: HTMLIFrameElement;
  ownerDocument: Document;
  target: HTMLButtonElement;
} {
  const frame = parentDocument.createElement("iframe");
  parentDocument.body.append(frame);
  Object.defineProperty(frame.contentWindow, "frameElement", {
    configurable: true,
    value: frame,
  });
  const ownerDocument = frame.contentDocument!;
  const target = ownerDocument.createElement("button");
  ownerDocument.body.append(target);
  return { frame, ownerDocument, target };
}

describe("focus restoration targets", () => {
  it.each([
    ["pointer", "pointer", "programmatic"],
    ["keyboard-command", "pointer", "programmatic"],
    ["keyboard-navigation", "pointer", "programmatic"],
    ["pointer", "keyboard-navigation", "keyboard-navigation"],
    ["keyboard-command", "keyboard-navigation", "keyboard-navigation"],
    ["keyboard-navigation", "programmatic", "keyboard-navigation"],
    ["keyboard-command", "programmatic", "programmatic"],
  ] as const)(
    "resolves %s opening and %s latest intent to %s restoration",
    (openingIntent, latestIntent, expected) => {
      expect(resolveFocusRestorationIntent(openingIntent, latestIntent)).toBe(expected);
    },
  );

  it("focuses a connected, visible, enabled target", () => {
    const button = document.createElement("button");
    document.body.append(button);

    expect(focusElementIfUsable(button)).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("rejects disconnected, disabled, hidden, inert, and closed-dialog targets", () => {
    const disconnected = document.createElement("button");
    expect(isUsableFocusTarget(disconnected)).toBe(false);

    const disabled = document.createElement("button");
    disabled.disabled = true;
    document.body.append(disabled);
    expect(isUsableFocusTarget(disabled)).toBe(false);

    const ariaDisabled = document.createElement("button");
    ariaDisabled.setAttribute("aria-disabled", "true");
    document.body.append(ariaDisabled);
    expect(isUsableFocusTarget(ariaDisabled)).toBe(false);

    for (const attribute of ["hidden", "inert", "aria-hidden"] as const) {
      const owner = document.createElement("div");
      owner.setAttribute(attribute, attribute === "aria-hidden" ? "true" : "");
      const target = document.createElement("button");
      owner.append(target);
      document.body.append(owner);
      expect(isUsableFocusTarget(target)).toBe(false);
    }

    const cssHiddenOwner = document.createElement("div");
    cssHiddenOwner.style.display = "none";
    const cssHiddenTarget = document.createElement("button");
    cssHiddenOwner.append(cssHiddenTarget);
    document.body.append(cssHiddenOwner);
    expect(isUsableFocusTarget(cssHiddenTarget)).toBe(false);

    const displayOwner = document.createElement("div");
    displayOwner.style.display = "none";
    const displayHidden = document.createElement("button");
    displayOwner.append(displayHidden);
    document.body.append(displayOwner);
    expect(isUsableFocusTarget(displayHidden)).toBe(false);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Actions";
    const detailsButton = document.createElement("button");
    details.append(summary, detailsButton);
    document.body.append(details);
    expect(isUsableFocusTarget(summary)).toBe(true);
    expect(isUsableFocusTarget(detailsButton)).toBe(false);

    const dialog = document.createElement("dialog");
    const dialogButton = document.createElement("button");
    dialog.append(dialogButton);
    document.body.append(dialog);
    expect(isUsableFocusTarget(dialogButton)).toBe(false);
  });

  it("resolves a valid current origin without treating the document body as an owner", () => {
    expect(currentFocusOrigin()).toBeNull();

    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(currentFocusOrigin()).toBe(button);

    button.disabled = true;
    expect(currentFocusOrigin()).toBeNull();

    const page = document.createElement("main");
    page.className = "page-shell";
    page.tabIndex = -1;
    document.body.append(page);
    page.focus();
    expect(currentFocusOrigin()).toBeNull();
  });

  it("captures opening intent and restores only interactive ordinary origins", () => {
    const stop = focusPresentationRuntime.start(document);
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    focusPresentationRuntime.markKeyboardNavigation();
    const record = captureFocusReturn();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.open = true;
    const close = dialog.appendChild(document.createElement("button"));
    claimFocusReturnSurface(record, dialog);
    focusPresentationRuntime.markProgrammatic();
    close.focus();
    dialog.open = false;

    expect(record.candidate).toBe(opener);
    expect(record.candidateIsInteractive).toBe(true);
    expect(record.candidateIsGenericPage).toBe(false);
    expect(record.activeDocument).toBe(document);
    expect(record.surface).toBe(dialog);
    expect(focusCapturedReturn(record)).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(focusPresentationRuntime.getIntent()).toBe("keyboard-navigation");
    expect(focusCapturedReturn(record)).toBe(false);
    stop();
  });

  it("preserves navigation performed after a pointer-opened surface", () => {
    const stop = focusPresentationRuntime.start(document);
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    focusPresentationRuntime.markPointer();
    const record = captureFocusReturn();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.open = true;
    claimFocusReturnSurface(record, dialog);
    dialog.appendChild(document.createElement("button")).focus();
    focusPresentationRuntime.markKeyboardNavigation();
    dialog.open = false;

    expect(focusCapturedReturn(record)).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(focusPresentationRuntime.getIntent()).toBe("keyboard-navigation");
    stop();
  });

  it("lets pointer interaction override a keyboard-navigation opening", () => {
    const stop = focusPresentationRuntime.start(document);
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    focusPresentationRuntime.markKeyboardNavigation();
    const record = captureFocusReturn();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.open = true;
    claimFocusReturnSurface(record, dialog);
    dialog.appendChild(document.createElement("button")).focus();
    focusPresentationRuntime.markPointer();
    dialog.open = false;

    expect(focusCapturedReturn(record)).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(focusPresentationRuntime.getIntent()).toBe("programmatic");
    stop();
  });

  it("keeps generic page origins out of ordinary captured restoration", () => {
    const page = document.body.appendChild(document.createElement("main"));
    page.className = "reader-page";
    page.tabIndex = -1;
    page.focus();
    const record = captureFocusReturn();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.open = true;
    claimFocusReturnSurface(record, dialog);
    dialog.appendChild(document.createElement("button")).focus();
    dialog.open = false;
    page.focus();

    expect(record.candidateIsGenericPage).toBe(true);
    expect(focusCapturedReturn(record)).toBe(false);
    expect(focusIsUnowned()).toBe(true);
    expect(record.request.active).toBe(false);
  });

  it("leaves a missing return target unowned and lets the next Tab establish navigation", () => {
    const stop = focusPresentationRuntime.start(document);
    const record = captureFocusReturn();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.open = true;
    claimFocusReturnSurface(record, dialog);
    dialog.appendChild(document.createElement("button")).focus();
    dialog.open = false;

    expect(record.candidate).toBe(document.body);
    expect(record.candidateIsInteractive).toBe(false);
    expect(focusCapturedReturn(record)).toBe(false);
    expect(record.request.active).toBe(false);
    expect(focusIsUnowned()).toBe(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    expect(focusPresentationRuntime.getIntent()).toBe("keyboard-navigation");
    stop();
  });

  it("treats focus inside an unusable closing surface as unowned", () => {
    const dialog = document.createElement("dialog");
    dialog.open = true;
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    button.focus();
    expect(focusIsUnowned()).toBe(false);

    dialog.open = false;
    expect(focusIsUnowned()).toBe(true);

    dialog.open = true;
    button.focus();
    dialog.hidden = true;
    expect(focusIsUnowned()).toBe(true);
  });

  it("accepts a connected EPUB origin and rejects it after its iframe is removed", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame.contentWindow, "frameElement", {
      configurable: true,
      value: frame,
    });
    const epubDocument = frame.contentDocument!;
    const target = epubDocument.createElement("button");
    epubDocument.body.append(target);
    target.focus();

    expect(isUsableFocusTarget(target)).toBe(true);
    expect(currentFocusOrigin(epubDocument)).toBe(target);
    frame.focus();
    expect(currentFocusOrigin(document)).toBe(frame);
    target.focus();
    frame.hidden = true;
    expect(isUsableFocusTarget(target)).toBe(false);
    frame.hidden = false;
    frame.remove();
    expect(isUsableFocusTarget(target)).toBe(false);
    expect(currentFocusOrigin(epubDocument)).toBeNull();
    expect(focusElementIfUsable(target)).toBe(false);
  });

  it("does not restore into an EPUB document over a newer persistent parent owner", () => {
    const { target } = embeddedButton();
    const persistentOwner = document.body.appendChild(document.createElement("button"));
    target.focus();
    persistentOwner.focus();

    expect(focusElementIfRestorationOwned(target)).toBe(false);
    expect(document.activeElement).toBe(persistentOwner);
  });

  it("restores into an EPUB document when parent focus is unowned", () => {
    const { ownerDocument, target } = embeddedButton();

    expect(focusElementIfRestorationOwned(target)).toBe(true);
    expect(ownerDocument.activeElement).toBe(target);
  });

  it("restores into an EPUB document when the owning iframe has parent focus", () => {
    const { frame, ownerDocument, target } = embeddedButton();
    frame.focus();

    expect(document.activeElement).toBe(frame);
    expect(focusElementIfRestorationOwned(target)).toBe(true);
    expect(ownerDocument.activeElement).toBe(target);
  });

  it("rejects restoration through a disconnected iframe", () => {
    const { frame, target } = embeddedButton();
    frame.remove();

    expect(focusElementIfRestorationOwned(target)).toBe(false);
  });

  it("rejects restoration through hidden, inert, and disabled iframes", () => {
    for (const [attribute, value] of [
      ["hidden", ""],
      ["inert", ""],
      ["aria-disabled", "true"],
    ] as const) {
      const { frame, target } = embeddedButton();
      frame.setAttribute(attribute, value);

      expect(focusElementIfRestorationOwned(target)).toBe(false);
      frame.remove();
    }
  });

  it("rejects a nested EPUB branch when an ancestor document has another owner", () => {
    const { frame: outerFrame, ownerDocument: outerDocument } = embeddedButton();
    const { frame: innerFrame, target } = embeddedButton(outerDocument);
    const persistentOwner = document.body.appendChild(document.createElement("button"));
    innerFrame.focus();
    outerFrame.focus();
    target.focus();
    persistentOwner.focus();

    expect(focusElementIfRestorationOwned(target)).toBe(false);
    expect(document.activeElement).toBe(persistentOwner);
  });

  it("does not apply delayed restoration behind a newer transient owner", () => {
    const target = document.body.appendChild(document.createElement("button"));
    const modal = document.body.appendChild(document.createElement("dialog"));
    modal.open = true;
    const modalButton = modal.appendChild(document.createElement("button"));
    modalButton.focus();
    registerTransientSurface({
      element: modal,
      kind: "app-dialog",
      modal: true,
      onDismiss: () => undefined,
    });

    expect(focusElementIfRestorationOwned(target)).toBe(false);
    expect(document.activeElement).toBe(modalButton);
  });

  it("does not overwrite a newer persistent focus owner when the original became stale", () => {
    const staleOrigin = document.body.appendChild(document.createElement("button"));
    const target = document.body.appendChild(document.createElement("button"));
    const newerOwner = document.body.appendChild(document.createElement("button"));
    staleOrigin.remove();
    newerOwner.focus();

    expect(focusElementIfRestorationOwned(target, { invalidatedOrigin: staleOrigin })).toBe(false);
    expect(document.activeElement).toBe(newerOwner);
  });

  it("honors a delayed restoration request token before focusing", () => {
    const target = document.body.appendChild(document.createElement("button"));
    const requestIsCurrent = () => false;

    expect(focusElementIfRestorationOwned(target, { requestIsCurrent })).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
