import {
  dictionaryManagementCommandClient,
  type DictionaryManagementCommandClient,
} from "./dictionaryManagementCommandClient";
import type { DictionaryRegistrySnapshot } from "../types/dictionary";

export type DictionaryRegistryStoreSnapshot = Readonly<{
  error: string | null;
  registry: DictionaryRegistrySnapshot | null;
  revision: number;
  status: "idle" | "loading" | "ready" | "error";
}>;

export type DictionaryRegistrySource = Readonly<{
  ensureLoaded: () => void;
  getSnapshot: () => DictionaryRegistryStoreSnapshot;
  publish: (registry: DictionaryRegistrySnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDictionaryRegistryStore(
  managementClient: Pick<DictionaryManagementCommandClient, "list">,
): DictionaryRegistrySource {
  const listeners = new Set<() => void>();
  let loadRevision = 0;
  let snapshot: DictionaryRegistryStoreSnapshot = Object.freeze({
    error: null,
    registry: null,
    revision: 0,
    status: "idle",
  });

  function settle(next: Omit<DictionaryRegistryStoreSnapshot, "revision">) {
    snapshot = Object.freeze({ ...next, revision: snapshot.revision + 1 });
    for (const listener of listeners) listener();
  }

  return {
    ensureLoaded() {
      if (snapshot.status === "loading" || snapshot.status === "ready") return;
      const requestRevision = ++loadRevision;
      settle({ error: null, registry: snapshot.registry, status: "loading" });
      void Promise.resolve()
        .then(() => managementClient.list())
        .then((registry) => {
          if (requestRevision !== loadRevision) return;
          settle({ error: null, registry, status: "ready" });
        })
        .catch((error: unknown) => {
          if (requestRevision !== loadRevision) return;
          settle({ error: errorMessage(error), registry: snapshot.registry, status: "error" });
        });
    },
    getSnapshot: () => snapshot,
    publish(registry) {
      loadRevision += 1;
      settle({ error: null, registry, status: "ready" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const dictionaryRegistryStore = createDictionaryRegistryStore(
  dictionaryManagementCommandClient,
);
