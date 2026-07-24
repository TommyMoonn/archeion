import { useCallback, useSyncExternalStore } from "react";

import type { LibraryStorage, ScanStatus } from "../../storage/LibraryStorage";

type ArchiveScanActivityStore = {
  claim: ArchiveScanOperationClaim | null;
  listeners: Set<() => void>;
  observedScanning: boolean;
  unsubscribe: (() => void) | null;
};

const archiveScanOperationClaimBrand: unique symbol = Symbol("archiveScanOperationClaim");

export type ArchiveScanOperationClaim = {
  readonly [archiveScanOperationClaimBrand]: true;
};

const activityStores = new WeakMap<LibraryStorage, ArchiveScanActivityStore>();
const claimedStores = new WeakMap<
  ArchiveScanOperationClaim,
  { storage: LibraryStorage; store: ArchiveScanActivityStore }
>();

function getOrCreateStore(storage: LibraryStorage): ArchiveScanActivityStore {
  const existing = activityStores.get(storage);
  if (existing) return existing;

  const store: ArchiveScanActivityStore = {
    claim: null,
    listeners: new Set(),
    observedScanning: storage.getLibrarySnapshot().scanStatus.status === "scanning",
    unsubscribe: null,
  };
  activityStores.set(storage, store);
  return store;
}

function storeIsActive(store: ArchiveScanActivityStore): boolean {
  return store.claim !== null || store.observedScanning;
}

function publishActivityChange(store: ArchiveScanActivityStore, wasActive: boolean) {
  if (storeIsActive(store) === wasActive) return;
  store.listeners.forEach((listener) => listener());
}

function releaseUnusedStore(storage: LibraryStorage, store: ArchiveScanActivityStore) {
  if (store.listeners.size > 0 || store.claim || store.observedScanning) return;

  store.unsubscribe?.();
  store.unsubscribe = null;
  if (activityStores.get(storage) === store) activityStores.delete(storage);
}

function publishScanStatus(
  storage: LibraryStorage,
  store: ArchiveScanActivityStore,
  status: ScanStatus,
) {
  const wasActive = storeIsActive(store);
  store.observedScanning = status.status === "scanning";
  publishActivityChange(store, wasActive);
  releaseUnusedStore(storage, store);
}

function ensureStatusSubscription(storage: LibraryStorage, store: ArchiveScanActivityStore) {
  if (store.unsubscribe) return;

  let active = true;
  const unsubscribe = storage.observeLibrarySnapshot({
    next: (snapshot) => {
      if (active) publishScanStatus(storage, store, snapshot.scanStatus);
    },
  });
  store.unsubscribe = () => {
    active = false;
    unsubscribe();
  };
}

function subscribeToArchiveScanActivity(storage: LibraryStorage, listener: () => void) {
  const store = getOrCreateStore(storage);
  store.listeners.add(listener);
  ensureStatusSubscription(storage, store);

  return () => {
    store.listeners.delete(listener);
    releaseUnusedStore(storage, store);
  };
}

export function isArchiveScanActive(storage: LibraryStorage): boolean {
  const store = activityStores.get(storage);
  return store ? storeIsActive(store) : false;
}

export function tryAcquireArchiveScanOperation(
  storage: LibraryStorage,
): ArchiveScanOperationClaim | null {
  const store = getOrCreateStore(storage);
  if (storeIsActive(store)) return null;

  const wasActive = storeIsActive(store);
  const claim = Object.freeze({
    [archiveScanOperationClaimBrand]: true as const,
  });
  store.claim = claim;
  claimedStores.set(claim, { storage, store });
  publishActivityChange(store, wasActive);
  return claim;
}

export function releaseArchiveScanOperation(claim: ArchiveScanOperationClaim): void {
  const owner = claimedStores.get(claim);
  if (!owner) return;

  claimedStores.delete(claim);
  const { storage, store } = owner;
  if (store.claim !== claim) return;

  const wasActive = storeIsActive(store);
  store.claim = null;
  publishActivityChange(store, wasActive);
  releaseUnusedStore(storage, store);
}

export function useArchiveScanActivity(storage: LibraryStorage): boolean {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToArchiveScanActivity(storage, listener),
    [storage],
  );
  const getSnapshot = useCallback(() => isArchiveScanActive(storage), [storage]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
