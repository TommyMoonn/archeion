import { useEffect, useSyncExternalStore, type ComponentType } from "react";

type PanelModuleState<Props> =
  | { status: "module-loading"; Component?: never }
  | { status: "ready"; Component: ComponentType<Props> }
  | { status: "error"; Component?: never };

/** Code is shared across books. Publication data stays with the Reader session owners. */
export function createReaderPanelModule<Props>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  let state: PanelModuleState<Props> = { status: "module-loading" };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PanelModuleState<Props>) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const preload = () => {
    if (state.status === "ready") return Promise.resolve();
    if (pending) return pending;
    publish({ status: "module-loading" });
    pending = Promise.resolve()
      .then(load)
      .then(
        ({ default: Component }) => publish({ status: "ready", Component }),
        () => {
          pending = undefined;
          publish({ status: "error" });
        },
      );
    return pending;
  };
  return {
    preload,
    useModule() {
      const snapshot = useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
      );
      useEffect(() => {
        void preload();
      }, []);
      return snapshot;
    },
  };
}
