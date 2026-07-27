import { createContext, useContext } from "react";

export type TooltipStore = {
  clear: () => void;
  dismiss: (id?: string) => void;
  getActiveId: () => string | null;
  schedule: (id: string, delay: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export const TooltipContext = createContext<TooltipStore | null>(null);

export function createTooltipStore(): TooltipStore {
  let activeId: string | null = null;
  let pending: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach((listener) => listener());
  const clearPending = (id?: string) => {
    if (!pending || (id && pending.id !== id)) return;
    clearTimeout(pending.timer);
    pending = null;
  };
  const dismiss = (id?: string) => {
    clearPending(id);
    if (id && activeId !== id) return;
    if (activeId === null) return;
    activeId = null;
    notify();
  };

  return {
    clear: () => {
      clearPending();
      dismiss();
    },
    dismiss,
    getActiveId: () => activeId,
    schedule: (id, delay) => {
      clearPending();
      if (activeId === id) return;
      if (activeId !== null) {
        activeId = null;
        notify();
      }
      pending = {
        id,
        timer: setTimeout(() => {
          pending = null;
          activeId = id;
          notify();
        }, delay),
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useOwnedTooltipAvailable(): boolean {
  return useContext(TooltipContext) !== null;
}
