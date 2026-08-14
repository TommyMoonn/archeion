import { createContext, useCallback, useContext, useLayoutEffect, useRef } from "react";

export type ReaderTransientSurfaceKind =
  | "annotation-detail"
  | "dictionary-definition"
  | "external-link"
  | "footnote"
  | "highlight-palette"
  | "illustration"
  | "note-editor";

export type ReaderSideSurfaceDismissHandler = (restoreFocus?: boolean) => boolean;

type ReaderSideSurfaceDismissEntry = Readonly<{
  handler: ReaderSideSurfaceDismissHandler;
  id: number;
  kind: ReaderTransientSurfaceKind;
}>;

const READER_TRANSIENT_SURFACE_PRIORITY: Record<ReaderTransientSurfaceKind, number> = {
  "annotation-detail": 10,
  "note-editor": 20,
  "highlight-palette": 30,
  "dictionary-definition": 35,
  footnote: 40,
  "external-link": 50,
  illustration: 60,
};

export type ReaderSideSurfaceDismissController = Readonly<{
  dismissTopmost: () => boolean;
  register: (
    kind: ReaderTransientSurfaceKind,
    handler: ReaderSideSurfaceDismissHandler,
  ) => () => void;
  setFallback: (handler: ReaderSideSurfaceDismissHandler | null) => void;
}>;

export type ReaderSideSurfaceDismissOwnership = Readonly<{
  readerOwned: boolean;
  requestDismissal: () => boolean;
}>;

export function createReaderSideSurfaceDismissController(): ReaderSideSurfaceDismissController {
  let entries: ReaderSideSurfaceDismissEntry[] = [];
  let fallback: ReaderSideSurfaceDismissHandler | null = null;
  let sequence = 0;

  const topmost = () =>
    entries.reduce<ReaderSideSurfaceDismissEntry | undefined>((current, candidate) => {
      if (!current) return candidate;
      const currentPriority = READER_TRANSIENT_SURFACE_PRIORITY[current.kind];
      const candidatePriority = READER_TRANSIENT_SURFACE_PRIORITY[candidate.kind];
      return candidatePriority > currentPriority ||
        (candidatePriority === currentPriority && candidate.id > current.id)
        ? candidate
        : current;
    }, undefined);

  return {
    dismissTopmost() {
      const entry = topmost();
      if (entry?.handler(true)) return true;
      return fallback?.(true) ?? false;
    },
    register(kind, handler) {
      const entry = { handler, id: ++sequence, kind };
      entries.push(entry);
      for (const candidate of [...entries]) {
        if (
          candidate !== entry &&
          READER_TRANSIENT_SURFACE_PRIORITY[candidate.kind] <
            READER_TRANSIENT_SURFACE_PRIORITY[kind]
        ) {
          candidate.handler(false);
        }
      }
      return () => {
        entries = entries.filter((candidate) => candidate !== entry);
      };
    },
    setFallback(handler) {
      fallback = handler;
    },
  };
}

export const ReaderSideSurfaceDismissContext =
  createContext<ReaderSideSurfaceDismissController | null>(null);

export function useReaderSideSurfaceDismiss(
  handler: ReaderSideSurfaceDismissHandler,
  active = true,
  kind: ReaderTransientSurfaceKind = "annotation-detail",
): ReaderSideSurfaceDismissOwnership {
  const controller = useContext(ReaderSideSurfaceDismissContext);
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    if (!active || !controller) return;
    return controller.register(kind, (restoreFocus) => handlerRef.current(restoreFocus));
  }, [active, controller, kind]);

  const requestDismissal = useCallback(
    () => controller?.dismissTopmost() ?? handlerRef.current(),
    [controller],
  );

  return {
    readerOwned: controller !== null,
    requestDismissal,
  };
}

export function useReaderSideSurfaceDismissRequest(): () => boolean {
  const controller = useContext(ReaderSideSurfaceDismissContext);
  return useCallback(() => controller?.dismissTopmost() ?? false, [controller]);
}
