import { activeTransientSurfaceElement } from "./transientSurfaceOwnership";
import { focusPresentationRuntime, type FocusPresentationIntent } from "../app/inputModality";

const FOCUSABLE_DISABLED_SELECTOR = ":disabled, [aria-disabled='true']";
const INTERACTIVE_FOCUS_TARGET_SELECTOR =
  "button, a[href], iframe, input, select, summary, textarea, [contenteditable]:not([contenteditable='false']), [role='button'], [role='checkbox'], [role='combobox'], [role='link'], [role='menuitem'], [role='option'], [role='radio'], [role='switch'], [role='tab'], [tabindex]:not([tabindex='-1'])";
const GENERIC_PAGE_FOCUS_TARGET_SELECTOR = "main[tabindex='-1']";

function isHtmlElement(target: Element | null | undefined): target is HTMLElement {
  if (!target) return false;
  const constructor = target.ownerDocument.defaultView?.HTMLElement;
  return constructor ? target instanceof constructor : target instanceof HTMLElement;
}

function isInsideVisibleDetailsContent(target: HTMLElement): boolean {
  const closedDetails = target.closest("details:not([open])");
  if (!closedDetails) return true;
  const summary = Array.from(closedDetails.children).find(
    (child) => child.tagName.toLocaleLowerCase() === "summary",
  );
  return Boolean(summary && (summary === target || summary.contains(target)));
}

function owningFrameElement(ownerDocument: Document): HTMLElement | null {
  const frame = ownerDocument.defaultView?.frameElement;
  return isHtmlElement(frame) ? frame : null;
}

export function isUsableFocusTarget(target: Element | null | undefined): target is HTMLElement {
  if (!isHtmlElement(target) || !target.isConnected) return false;
  if (target.matches(FOCUSABLE_DISABLED_SELECTOR)) return false;
  if (!isInsideVisibleDetailsContent(target)) return false;

  const ownerDocument = target.ownerDocument;
  const view = ownerDocument.defaultView;
  for (let current: HTMLElement | null = target; current; current = current.parentElement) {
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    if (current.tagName === "DIALOG" && !(current as HTMLDialogElement).open) return false;
    if (current.tagName === "DETAILS" && !(current as HTMLDetailsElement).open) {
      const summary = Array.from(current.children).find((child) => child.tagName === "SUMMARY");
      if (!summary?.contains(target)) return false;
    }

    const style = view?.getComputedStyle(current);
    if (
      current.style.display === "none" ||
      current.style.visibility === "hidden" ||
      current.style.visibility === "collapse" ||
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return false;
    }
  }

  if (typeof document !== "undefined" && ownerDocument !== document) {
    const frame = owningFrameElement(ownerDocument);
    if (!frame || !isUsableFocusTarget(frame)) return false;
  }

  return true;
}

export function currentFocusOrigin(ownerDocument: Document = document): HTMLElement | null {
  const activeElement = ownerDocument.activeElement;
  return isHtmlElement(activeElement) &&
    !focusIsUnowned(ownerDocument) &&
    isUsableFocusTarget(activeElement) &&
    isInteractiveFocusTarget(activeElement)
    ? activeElement
    : null;
}

export function isInteractiveFocusTarget(
  target: Element | null | undefined,
): target is HTMLElement {
  return isHtmlElement(target) && target.matches(INTERACTIVE_FOCUS_TARGET_SELECTOR);
}

export function isGenericPageFocusTarget(target: Element | null | undefined): boolean {
  return isHtmlElement(target) && target.matches(GENERIC_PAGE_FOCUS_TARGET_SELECTOR);
}

export type FocusReturnRecord = {
  readonly activeDocument: Document;
  readonly candidate: HTMLElement | null;
  readonly candidateIsGenericPage: boolean;
  readonly candidateIsInteractive: boolean;
  readonly openingIntent: FocusPresentationIntent;
  readonly request: { active: boolean };
  surface: HTMLElement | null;
};

export function captureFocusReturn(
  candidate: HTMLElement | null | undefined = undefined,
  ownerDocument: Document = document,
): FocusReturnRecord {
  const activeCandidate =
    candidate === undefined
      ? isHtmlElement(ownerDocument.activeElement) &&
        isUsableFocusTarget(ownerDocument.activeElement)
        ? ownerDocument.activeElement
        : null
      : candidate;

  return {
    activeDocument: ownerDocument,
    candidate: activeCandidate,
    candidateIsGenericPage: isGenericPageFocusTarget(activeCandidate),
    candidateIsInteractive: isInteractiveFocusTarget(activeCandidate),
    openingIntent: focusPresentationRuntime.getIntent(),
    request: { active: true },
    surface: null,
  };
}

export function claimFocusReturnSurface(
  record: FocusReturnRecord,
  surface: HTMLElement | null,
): void {
  record.surface = surface;
}

export function focusCapturedReturn(
  record: FocusReturnRecord,
  options: Omit<OwnedFocusRestorationOptions, "closingSurface" | "ownerDocument"> = {},
): boolean {
  if (!record.request.active || !record.surface) return false;

  record.request.active = false;
  if (!record.candidateIsInteractive || record.candidateIsGenericPage) {
    if (
      record.candidateIsGenericPage &&
      record.candidate &&
      record.activeDocument.activeElement === record.candidate
    ) {
      record.candidate.blur();
    }
    return false;
  }

  const closingIntent = focusPresentationRuntime.getIntent();
  const restored = focusElementIfRestorationOwned(record.candidate, {
    ...options,
    closingSurface: record.surface,
    ownerDocument: record.activeDocument,
  });
  if (restored) {
    const restorationIntent = resolveFocusRestorationIntent(record.openingIntent, closingIntent);
    if (restorationIntent === "keyboard-navigation") {
      focusPresentationRuntime.markKeyboardNavigation();
    } else {
      focusPresentationRuntime.markProgrammatic();
    }
  }
  return restored;
}

export function resolveFocusRestorationIntent(
  openingIntent: FocusPresentationIntent,
  latestIntent: FocusPresentationIntent,
): Extract<FocusPresentationIntent, "keyboard-navigation" | "programmatic"> {
  if (latestIntent === "pointer") return "programmatic";
  if (latestIntent === "keyboard-navigation") return "keyboard-navigation";
  return openingIntent === "keyboard-navigation" ? "keyboard-navigation" : "programmatic";
}

export function focusElementIfUsable(
  target: Element | null | undefined,
  options: FocusOptions = { preventScroll: true },
): boolean {
  if (!isUsableFocusTarget(target)) return false;
  target.focus(options);
  return target.ownerDocument.activeElement === target;
}

export type OwnedFocusRestorationOptions = Readonly<{
  closingSurface?: HTMLElement | null;
  invalidatedOrigin?: HTMLElement | null;
  ownerDocument?: Document;
  requestIsCurrent?: () => boolean;
  resumedSurface?: HTMLElement | null;
}>;

function surfaceContainsActiveElement(
  surface: HTMLElement | null,
  activeElement: Element | null,
): boolean {
  return Boolean(
    surface &&
    activeElement &&
    surface.ownerDocument === activeElement.ownerDocument &&
    surface.contains(activeElement),
  );
}

function documentFocusRemainsOwned(
  ownerDocument: Document,
  expectedOwner: Element,
  closingSurface: HTMLElement | null,
  invalidatedOrigin: HTMLElement | null,
): boolean {
  const activeElement = ownerDocument.activeElement;
  return (
    activeElement === expectedOwner ||
    focusIsUnowned(ownerDocument) ||
    surfaceContainsActiveElement(closingSurface, activeElement) ||
    activeElement === invalidatedOrigin
  );
}

function embeddedDocumentBranchRemainsOwned(
  targetDocument: Document,
  closingSurface: HTMLElement | null,
  invalidatedOrigin: HTMLElement | null,
): boolean {
  if (typeof document === "undefined") return false;

  let currentDocument = targetDocument;
  const visited = new Set<Document>();
  while (currentDocument !== document) {
    if (visited.has(currentDocument)) return false;
    visited.add(currentDocument);

    const frame = owningFrameElement(currentDocument);
    if (!frame || !isUsableFocusTarget(frame)) return false;

    const parentDocument = frame.ownerDocument;
    if (!documentFocusRemainsOwned(parentDocument, frame, closingSurface, invalidatedOrigin)) {
      return false;
    }
    currentDocument = parentDocument;
  }

  return true;
}

export function focusElementIfRestorationOwned(
  target: Element | null | undefined,
  {
    closingSurface = null,
    invalidatedOrigin = null,
    ownerDocument = target?.ownerDocument ?? document,
    requestIsCurrent,
    resumedSurface = null,
  }: OwnedFocusRestorationOptions = {},
  focusOptions: FocusOptions = { preventScroll: true },
): boolean {
  if (requestIsCurrent && !requestIsCurrent()) return false;
  if (!isUsableFocusTarget(target)) return false;

  const activeSurface = activeTransientSurfaceElement();
  if (
    activeSurface &&
    activeSurface !== closingSurface &&
    activeSurface !== resumedSurface &&
    !activeSurface.contains(target)
  ) {
    return false;
  }

  if (!documentFocusRemainsOwned(ownerDocument, target, closingSurface, invalidatedOrigin)) {
    return false;
  }
  if (
    typeof document !== "undefined" &&
    target.ownerDocument !== document &&
    !embeddedDocumentBranchRemainsOwned(target.ownerDocument, closingSurface, invalidatedOrigin)
  ) {
    return false;
  }

  return focusElementIfUsable(target, focusOptions);
}

export function focusIsUnowned(ownerDocument: Document = document): boolean {
  const activeElement = ownerDocument.activeElement;
  return (
    !isHtmlElement(activeElement) ||
    activeElement === ownerDocument.body ||
    activeElement === ownerDocument.documentElement ||
    !isUsableFocusTarget(activeElement)
  );
}
