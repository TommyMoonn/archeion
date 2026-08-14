import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  dictionaryLookupCommandClient,
  type DictionaryLookupCommandClient,
} from "../../storage/dictionaryLookupCommandClient";
import {
  dictionaryRegistryStore,
  type DictionaryRegistrySource,
} from "../../storage/dictionaryRegistryStore";
import type { DictionaryDefinitionEntry } from "../../types/dictionary";
import type { ReaderSessionIdentity } from "./readerSession";
import type { HighlightInteractionMenu } from "./useHighlightPaletteController";

const MAX_DICTIONARY_TERM_CHARACTERS = 256;
const SURROUNDING_PUNCTUATION = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "¡",
  "¿",
  '"',
  "'",
  "‘",
  "’",
  "“",
  "”",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "<",
  ">",
]);

export type ReaderDictionaryLookupStatus = "idle" | "looking-up" | "ready" | "no-results" | "error";

export type ReaderDictionaryLookupState = Readonly<{
  error: string | null;
  requestRevision: number;
  results: readonly DictionaryDefinitionEntry[];
  selectedTerm: string | null;
  selectionOwner: HighlightInteractionMenu | null;
  status: ReaderDictionaryLookupStatus;
  truncated: boolean;
}>;

export type ReaderDefineAvailability =
  | Readonly<{ action: "define"; available: true; label: "Define"; reason: null }>
  | Readonly<{
      action: "manage-dictionaries";
      available: true;
      label: "Manage dictionaries";
      reason: string;
    }>
  | Readonly<{
      action: "unavailable";
      available: false;
      label: "Define";
      reason: string;
    }>;

type ReaderDictionaryLookupDependencies = Readonly<{
  lookupClient: DictionaryLookupCommandClient;
  registrySource: DictionaryRegistrySource;
}>;

type UseReaderDictionaryLookupOptions = Readonly<{
  dependencies?: ReaderDictionaryLookupDependencies;
  onManageDictionaries: (focusTarget?: HTMLElement) => void;
  selectionOwner: HighlightInteractionMenu | null;
  sessionIdentity: ReaderSessionIdentity;
}>;

const INITIAL_STATE: ReaderDictionaryLookupState = Object.freeze({
  error: null,
  requestRevision: 0,
  results: Object.freeze([]),
  selectedTerm: null,
  selectionOwner: null,
  status: "idle",
  truncated: false,
});

const DEFAULT_DEPENDENCIES: ReaderDictionaryLookupDependencies = Object.freeze({
  lookupClient: dictionaryLookupCommandClient,
  registrySource: dictionaryRegistryStore,
});

function lookupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeReaderDictionaryTerm(value: string): string | null {
  if ([...value].length > MAX_DICTIONARY_TERM_CHARACTERS) return null;
  let normalized = value.trim().split(/\s+/u).filter(Boolean).join(" ");
  while (normalized) {
    const characters = [...normalized];
    let start = 0;
    let end = characters.length;
    while (start < end && SURROUNDING_PUNCTUATION.has(characters[start]!)) start += 1;
    while (end > start && SURROUNDING_PUNCTUATION.has(characters[end - 1]!)) end -= 1;
    const stripped = characters.slice(start, end).join("").trim();
    if (stripped === normalized) break;
    normalized = stripped;
  }
  const lowered = normalized.toLowerCase();
  return lowered && [...lowered].length <= MAX_DICTIONARY_TERM_CHARACTERS ? lowered : null;
}

export function useReaderDictionaryLookup({
  dependencies = DEFAULT_DEPENDENCIES,
  onManageDictionaries,
  selectionOwner,
  sessionIdentity,
}: UseReaderDictionaryLookupOptions) {
  const registrySnapshot = useSyncExternalStore(
    dependencies.registrySource.subscribe,
    dependencies.registrySource.getSnapshot,
    dependencies.registrySource.getSnapshot,
  );
  const [state, setState] = useState<ReaderDictionaryLookupState>(INITIAL_STATE);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const requestRevisionRef = useRef(0);
  const sessionIdentityRef = useRef(sessionIdentity);
  const registryRevisionRef = useRef(registrySnapshot.revision);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const retire = useCallback(() => {
    if (stateRef.current.status === "idle") return;
    requestRevisionRef.current += 1;
    stateRef.current = {
      ...INITIAL_STATE,
      requestRevision: requestRevisionRef.current,
    };
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    dependencies.registrySource.ensureLoaded();
    return () => {
      mountedRef.current = false;
      requestRevisionRef.current += 1;
    };
  }, [dependencies.registrySource]);

  useLayoutEffect(() => {
    if (sessionIdentityRef.current !== sessionIdentity) {
      sessionIdentityRef.current = sessionIdentity;
      retire();
    }
  }, [retire, sessionIdentity]);

  useLayoutEffect(() => {
    if (registryRevisionRef.current !== registrySnapshot.revision) {
      registryRevisionRef.current = registrySnapshot.revision;
      retire();
    }
  }, [registrySnapshot.revision, retire]);

  useLayoutEffect(() => {
    const currentOwner = stateRef.current.selectionOwner;
    if (currentOwner && selectionOwner && currentOwner !== selectionOwner) retire();
  }, [retire, selectionOwner]);

  const availabilityFor = useCallback(
    (selectedText: string): ReaderDefineAvailability => {
      if (!normalizeReaderDictionaryTerm(selectedText)) {
        return {
          action: "unavailable",
          available: false,
          label: "Define",
          reason: "Select a word or short phrase to define.",
        };
      }
      if (registrySnapshot.status === "idle" || registrySnapshot.status === "loading") {
        return {
          action: "unavailable",
          available: false,
          label: "Define",
          reason: "Checking installed dictionaries.",
        };
      }
      const hasEnabledDictionary = Boolean(
        registrySnapshot.registry?.status === "ready" &&
        registrySnapshot.registry.dictionaries.some(
          (dictionary) => dictionary.enabled && dictionary.indexState === "ready",
        ),
      );
      if (!hasEnabledDictionary) {
        return {
          action: "manage-dictionaries",
          available: true,
          label: "Manage dictionaries",
          reason:
            registrySnapshot.status === "error"
              ? "Installed dictionaries could not be checked."
              : "Install or enable a dictionary to define selected text.",
        };
      }
      return { action: "define", available: true, label: "Define", reason: null };
    },
    [registrySnapshot],
  );

  const define = useCallback(
    (owner: HighlightInteractionMenu) => {
      const availability = availabilityFor(owner.selection.selectedText);
      if (availability.action === "manage-dictionaries") {
        onManageDictionaries(owner.anchor.focusTarget);
        return;
      }
      if (!availability.available) return;

      const selectedTerm = normalizeReaderDictionaryTerm(owner.selection.selectedText);
      if (!selectedTerm) return;
      const requestRevision = ++requestRevisionRef.current;
      const lookingUp: ReaderDictionaryLookupState = {
        error: null,
        requestRevision,
        results: Object.freeze([]),
        selectedTerm,
        selectionOwner: owner,
        status: "looking-up",
        truncated: false,
      };
      stateRef.current = lookingUp;
      setState(lookingUp);

      void dependencies.lookupClient
        .lookup(owner.selection.selectedText)
        .then((response) => {
          if (
            !mountedRef.current ||
            requestRevision !== requestRevisionRef.current ||
            sessionIdentityRef.current !== sessionIdentity
          ) {
            return;
          }
          const settled: ReaderDictionaryLookupState = {
            error: null,
            requestRevision,
            results: response.entries,
            selectedTerm: response.normalizedQuery,
            selectionOwner: owner,
            status: response.entries.length > 0 ? "ready" : "no-results",
            truncated: response.truncated,
          };
          stateRef.current = settled;
          setState(settled);
        })
        .catch((error: unknown) => {
          if (
            !mountedRef.current ||
            requestRevision !== requestRevisionRef.current ||
            sessionIdentityRef.current !== sessionIdentity
          ) {
            return;
          }
          const failed: ReaderDictionaryLookupState = {
            error: lookupErrorMessage(error),
            requestRevision,
            results: Object.freeze([]),
            selectedTerm,
            selectionOwner: owner,
            status: "error",
            truncated: false,
          };
          stateRef.current = failed;
          setState(failed);
        });
    },
    [availabilityFor, dependencies.lookupClient, onManageDictionaries, sessionIdentity],
  );

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== "error" || !current.selectionOwner) return;
    define(current.selectionOwner);
  }, [define]);

  const handleDocumentRemoved = useCallback(
    (document: Document) => {
      if (stateRef.current.selectionOwner?.anchor.document === document) retire();
    },
    [retire],
  );

  const handleSelectionCollapsed = useCallback(
    (document: Document) => {
      if (stateRef.current.selectionOwner?.anchor.document === document) retire();
    },
    [retire],
  );

  return {
    availabilityFor,
    define,
    dismiss: retire,
    handleDocumentRemoved,
    handleSelectionCollapsed,
    retire,
    retry,
    state,
  };
}
