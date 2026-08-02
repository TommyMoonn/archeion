import { useLayoutEffect, useRef, type RefObject } from "react";

export type TransientSurfaceKind =
  | "app-dialog"
  | "context-menu"
  | "details-menu"
  | "drawer"
  | "inline-editor"
  | "popover"
  | "quick-actions"
  | "reader-panel"
  | "settings";

export const ACTIVE_TRANSIENT_SURFACE_SELECTOR = "[data-application-transient]";

type TransientSurfaceRegistration = {
  closeOnModalOpen?: boolean;
  dismissOnOutsidePointer?: boolean;
  element: HTMLElement;
  kind: TransientSurfaceKind;
  modal?: boolean;
  onDismiss: (reason: TransientSurfaceDismissReason) => void;
  origin?: HTMLElement | null;
  trigger?: HTMLElement | null;
};

export type TransientSurfaceDismissReason =
  "escape" | "modal-open" | "outside-pointer" | "window-blur";

type RegisteredTransientSurface = Required<
  Pick<TransientSurfaceRegistration, "closeOnModalOpen" | "dismissOnOutsidePointer" | "modal">
> &
  Omit<TransientSurfaceRegistration, "closeOnModalOpen" | "dismissOnOutsidePointer" | "modal"> & {
    token: object;
  };

const surfaceStack: RegisteredTransientSurface[] = [];
const ownershipListeners = new Set<() => void>();
const outsidePointerDismissals = new WeakSet<Event>();
let ownershipRevision = 0;
let listenersInstalled = false;

function publishOwnershipChange(): void {
  ownershipRevision += 1;
  for (const listener of ownershipListeners) listener();
}

function pruneDisconnectedSurfaces(): void {
  let changed = false;
  for (let index = surfaceStack.length - 1; index >= 0; index -= 1) {
    if (!surfaceStack[index]?.element.isConnected) {
      surfaceStack.splice(index, 1);
      changed = true;
    }
  }
  if (changed) publishOwnershipChange();
  uninstallListenersWhenIdle();
}

function topSurface(): RegisteredTransientSurface | undefined {
  pruneDisconnectedSurfaces();
  return surfaceStack.at(-1);
}

function ownsTarget(surface: RegisteredTransientSurface, target: EventTarget | null): boolean {
  return (
    target instanceof Node &&
    (surface.element.contains(target) || Boolean(surface.trigger?.contains(target)))
  );
}

export function claimTransientSurfaceEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const surface = topSurface();
  if (!surface) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  surface.onDismiss("escape");
  return true;
}

function handleEscape(event: KeyboardEvent): void {
  claimTransientSurfaceEscape(event);
}

function handlePointerDown(event: PointerEvent): void {
  const surface = topSurface();
  if (!surface?.dismissOnOutsidePointer || ownsTarget(surface, event.target)) return;
  outsidePointerDismissals.add(event);
  surface.onDismiss("outside-pointer");
}

export function transientSurfaceClaimedOutsidePointer(event: Event): boolean {
  return outsidePointerDismissals.has(event);
}

function handleWindowBlur(): void {
  const dismissible = [...surfaceStack]
    .reverse()
    .filter((surface) => !surface.modal && surface.element.isConnected);
  for (const surface of dismissible) surface.onDismiss("window-blur");
}

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("keydown", handleEscape, true);
  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("blur", handleWindowBlur);
}

function uninstallListenersWhenIdle(): void {
  if (!listenersInstalled || surfaceStack.length > 0 || typeof window === "undefined") return;
  listenersInstalled = false;
  window.removeEventListener("keydown", handleEscape, true);
  window.removeEventListener("pointerdown", handlePointerDown, true);
  window.removeEventListener("blur", handleWindowBlur);
}

function unregister(token: object): void {
  const index = surfaceStack.findIndex((surface) => surface.token === token);
  if (index >= 0) {
    surfaceStack.splice(index, 1);
    publishOwnershipChange();
  }
  uninstallListenersWhenIdle();
}

export function registerTransientSurface(registration: TransientSurfaceRegistration): () => void {
  const token = {};
  const surface: RegisteredTransientSurface = {
    closeOnModalOpen: registration.closeOnModalOpen ?? false,
    dismissOnOutsidePointer: registration.dismissOnOutsidePointer ?? false,
    modal: registration.modal ?? false,
    ...registration,
    token,
  };

  if (surface.modal) {
    const incompatible = [...surfaceStack].filter(
      (candidate) => candidate.closeOnModalOpen && candidate.element.isConnected,
    );
    for (const candidate of incompatible) candidate.onDismiss("modal-open");
  }

  surface.element.dataset.applicationTransient = surface.kind;
  surfaceStack.push(surface);
  publishOwnershipChange();
  installListeners();

  return () => {
    unregister(token);
    if (surface.element.dataset.applicationTransient === surface.kind) {
      delete surface.element.dataset.applicationTransient;
    }
  };
}

export function isTopmostTransientSurface(element: HTMLElement): boolean {
  return topSurface()?.element === element;
}

export function subscribeTransientSurfaceOwnership(listener: () => void): () => void {
  ownershipListeners.add(listener);
  return () => ownershipListeners.delete(listener);
}

export function transientSurfaceOwnershipSnapshot(): number {
  return ownershipRevision;
}

export function transientSurfaceOriginatesFrom(origin: Element | null | undefined): boolean {
  if (!origin) return false;
  return surfaceStack.some((surface) => {
    if (!surface.element.isConnected) return false;
    const candidates = [surface.origin, surface.trigger];
    return candidates.some(
      (candidate) =>
        candidate === origin ||
        Boolean(candidate && (origin.contains(candidate) || candidate.contains(origin))),
    );
  });
}

export function activeTransientSurfaceKind(): TransientSurfaceKind | null {
  return topSurface()?.kind ?? null;
}

export function activeTransientSurfaceElement(): HTMLElement | null {
  return topSurface()?.element ?? null;
}

type UseTransientSurfaceOwnershipOptions = Omit<
  TransientSurfaceRegistration,
  "element" | "origin" | "trigger"
> & {
  active?: boolean;
  elementRef: RefObject<HTMLElement | null>;
  origin?: HTMLElement | null;
  originRef?: RefObject<HTMLElement | null>;
  trigger?: HTMLElement | null;
  triggerRef?: RefObject<HTMLElement | null>;
};

export function useTransientSurfaceOwnership({
  active = true,
  closeOnModalOpen,
  dismissOnOutsidePointer,
  elementRef,
  kind,
  modal,
  onDismiss,
  origin,
  originRef,
  trigger,
  triggerRef,
}: UseTransientSurfaceOwnershipOptions): void {
  const onDismissRef = useRef(onDismiss);

  useLayoutEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!active || !element) return;

    return registerTransientSurface({
      closeOnModalOpen,
      dismissOnOutsidePointer,
      element,
      kind,
      modal,
      onDismiss: (reason) => onDismissRef.current(reason),
      origin: originRef?.current ?? origin,
      trigger: triggerRef?.current ?? trigger,
    });
  }, [
    active,
    elementRef,
    origin,
    originRef,
    closeOnModalOpen,
    dismissOnOutsidePointer,
    kind,
    modal,
    trigger,
    triggerRef,
  ]);
}

export function resetTransientSurfaceOwnershipForTests(): void {
  const hadSurfaces = surfaceStack.length > 0;
  surfaceStack.splice(0);
  if (hadSurfaces) publishOwnershipChange();
  uninstallListenersWhenIdle();
}
