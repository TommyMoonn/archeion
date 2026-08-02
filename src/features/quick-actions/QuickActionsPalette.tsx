import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { focusPresentationRuntime } from "../../app/inputModality";
import { Input } from "../../components/Input";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import type { FocusReturnRecord } from "../../utils/focusRestoration";
import {
  effectiveKeyboardBinding,
  formatKeyboardBinding,
  type KeyboardPreferences,
} from "../commands/commandBindings";
import { commandAvailability } from "../commands/commandResolver";
import {
  searchQuickActionModeOptions,
  type QuickActionChildMode,
  type QuickActionModeOption,
  type QuickActionModeSnapshot,
  type QuickActionPaletteOutcome,
} from "./quickActionModes";
import {
  createQuickActionIndex,
  searchQuickActions,
  type QuickActionRegistration,
  type QuickActionsRegistry,
} from "./quickActions";

type QuickActionsPaletteProps = {
  keyboard: KeyboardPreferences;
  focusReturn?: FocusReturnRecord;
  onClose: () => void;
  onExecute: (
    command: QuickActionRegistration,
  ) => Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome;
  registry: QuickActionsRegistry;
};

const EMPTY_MODE_SNAPSHOT: QuickActionModeSnapshot = { options: [] };
const subscribeToNothing = () => () => undefined;
const getEmptyModeSnapshot = () => EMPTY_MODE_SNAPSHOT;

export function QuickActionsPalette({
  focusReturn,
  keyboard,
  onClose,
  onExecute,
  registry,
}: QuickActionsPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeModeRef = useRef<QuickActionChildMode | null>(null);
  const activeModeOptionRef = useRef<QuickActionModeOption | undefined>(undefined);
  const modeQueryRef = useRef("");
  const modeResultsRef = useRef<readonly QuickActionModeOption[]>([]);
  const modeBusyRef = useRef(false);
  const rootBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const operationRevisionRef = useRef(0);
  const pointerStartedOnBackdropRef = useRef(false);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeMode, setActiveMode] = useState<QuickActionChildMode | null>(null);
  const [modeQuery, setModeQuery] = useState("");
  const [activeModeOptionId, setActiveModeOptionId] = useState<string>();
  const [modeBusy, setModeBusy] = useState(false);
  const [rootBusy, setRootBusy] = useState(false);
  const [modeError, setModeError] = useState<string>();
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const modeSnapshot = useSyncExternalStore(
    activeMode?.subscribe ?? subscribeToNothing,
    activeMode?.getSnapshot ?? getEmptyModeSnapshot,
    activeMode?.getSnapshot ?? getEmptyModeSnapshot,
  );
  const commandIndex = useMemo(
    () => createQuickActionIndex(snapshot.commands),
    [snapshot.commands],
  );
  const results = useMemo(
    () => searchQuickActions(commandIndex, query, snapshot.recentCommandIds),
    [commandIndex, query, snapshot.recentCommandIds],
  );
  const modeResults = useMemo(
    () => searchQuickActionModeOptions(modeSnapshot.options, modeQuery),
    [modeQuery, modeSnapshot.options],
  );
  const boundedActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);
  const activeCommand = results[boundedActiveIndex];
  const activeModeOption = resolveActiveModeOption(modeResults, activeModeOptionId);
  const displayedResults = activeMode ? modeResults : results;
  const activeResultId = activeMode
    ? activeModeOption
      ? optionDomId(listId, activeModeOption.id)
      : undefined
    : activeCommand
      ? optionDomId(listId, activeCommand.id)
      : undefined;

  function retirePendingOutcomes(): void {
    operationRevisionRef.current += 1;
  }

  function disposeActiveMode(): void {
    const mode = activeModeRef.current;
    activeModeRef.current = null;
    mode?.dispose();
  }

  function disposeUnusedOutcome(outcome: QuickActionPaletteOutcome): void {
    if (outcome.kind === "child-mode" && outcome.mode !== activeModeRef.current) {
      outcome.mode.dispose();
    }
  }

  function clearRootBusy(): void {
    if (!rootBusyRef.current) return;
    rootBusyRef.current = false;
    setRootBusy(false);
  }

  function closePalette(suppressFocusRestoration = false): void {
    if (suppressFocusRestoration) modal.suppressFocusRestoration();
    retirePendingOutcomes();
    disposeActiveMode();
    onClose();
  }

  function dismissPalette(): void {
    if (activeModeRef.current) returnToRoot();
    else closePalette();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDialogElement>): void {
    pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
    modal.onPointerDown(event);
  }

  function handleClick(event: ReactMouseEvent<HTMLDialogElement>): void {
    if (pointerStartedOnBackdropRef.current && event.target === event.currentTarget) {
      pointerStartedOnBackdropRef.current = false;
      closePalette();
      return;
    }
    pointerStartedOnBackdropRef.current = false;
    modal.onClick(event);
  }

  const modal = useModalDialogLifecycle({
    dialogRef,
    focusReturn,
    onClose: dismissPalette,
    surfaceKind: "quick-actions",
  });

  useEffect(() => {
    mountedRef.current = true;
    inputRef.current?.focus();
    return () => {
      mountedRef.current = false;
      rootBusyRef.current = false;
      retirePendingOutcomes();
      disposeActiveMode();
    };
  }, []);

  useEffect(() => {
    if (!activeMode?.preview) return;
    activeMode.preview(activeModeOption?.id);
  }, [activeMode, activeModeOption?.id, activeModeOption?.previewRevision]);

  useLayoutEffect(() => {
    activeModeRef.current = activeMode;
    activeModeOptionRef.current = activeModeOption;
    modeQueryRef.current = modeQuery;
    modeResultsRef.current = modeResults;
  }, [activeMode, activeModeOption, modeQuery, modeResults]);

  useLayoutEffect(() => {
    const resultsElement = resultsRef.current;
    if (!resultsElement || !activeResultId) return;
    const activeOption = document.getElementById(activeResultId);
    if (!activeOption || !resultsElement.contains(activeOption)) return;
    keepOptionVisible(resultsElement, activeOption);
  }, [activeResultId, displayedResults]);

  function enterMode(mode: QuickActionChildMode): void {
    clearRootBusy();
    retirePendingOutcomes();
    disposeActiveMode();
    activeModeRef.current = mode;
    setActiveMode(mode);
    const nextSnapshot = mode.getSnapshot();
    setModeQuery("");
    setActiveModeOptionId(
      resolveActiveModeOption(nextSnapshot.options, nextSnapshot.initialActiveOptionId)?.id,
    );
    setModeError(undefined);
    modeBusyRef.current = false;
    setModeBusy(false);
  }

  function returnToRoot(): void {
    clearRootBusy();
    retirePendingOutcomes();
    disposeActiveMode();
    setActiveMode(null);
    setModeQuery("");
    setActiveModeOptionId(undefined);
    setModeError(undefined);
    modeBusyRef.current = false;
    setModeBusy(false);
  }

  function applyOutcome(outcome: QuickActionPaletteOutcome): void {
    if (outcome.kind === "child-mode") {
      enterMode(outcome.mode);
      return;
    }
    if (outcome.kind === "keep-open") {
      setModeError(outcome.error);
      return;
    }
    closePalette(true);
  }

  function settleRootOutcome(
    command: QuickActionRegistration,
    outcome: QuickActionPaletteOutcome,
    operationRevision: number,
  ): void {
    if (!mountedRef.current || operationRevisionRef.current !== operationRevision) {
      disposeUnusedOutcome(outcome);
      return;
    }
    clearRootBusy();
    registry.recordRecent(command.id);
    applyOutcome(outcome);
  }

  function reportRootFailure(operationRevision: number): void {
    if (mountedRef.current && operationRevisionRef.current === operationRevision) {
      clearRootBusy();
      setModeError("The action could not be completed. Try again.");
    }
  }

  function executeRoot(command: QuickActionRegistration | undefined): void {
    if (rootBusyRef.current || !command || !commandAvailability(command).available) return;
    if (!command.runInPalette) {
      retirePendingOutcomes();
      modal.suppressFocusRestoration();
      void onExecute(command);
      return;
    }

    const operationRevision = ++operationRevisionRef.current;
    setModeError(undefined);
    let result: Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome;
    try {
      result = onExecute(command);
    } catch {
      reportRootFailure(operationRevision);
      return;
    }

    if (!isPromiseLike(result)) {
      settleRootOutcome(command, result, operationRevision);
      return;
    }

    rootBusyRef.current = true;
    setRootBusy(true);
    void Promise.resolve(result).then(
      (outcome) => settleRootOutcome(command, outcome, operationRevision),
      () => reportRootFailure(operationRevision),
    );
  }

  async function confirmModeOption(option: QuickActionModeOption | undefined): Promise<void> {
    const currentMode = activeModeRef.current;
    if (
      !currentMode ||
      !option ||
      modeBusyRef.current ||
      option.availability?.available === false
    ) {
      return;
    }
    const operationRevision = ++operationRevisionRef.current;
    const confirmingMode = currentMode;
    modeBusyRef.current = true;
    setModeBusy(true);
    setModeError(undefined);

    try {
      const outcome = await confirmingMode.confirm(option);
      if (
        !mountedRef.current ||
        activeModeRef.current !== confirmingMode ||
        operationRevisionRef.current !== operationRevision
      ) {
        disposeUnusedOutcome(outcome);
        return;
      }
      modeBusyRef.current = false;
      setModeBusy(false);
      applyOutcome(outcome);
    } catch {
      if (
        mountedRef.current &&
        activeModeRef.current === confirmingMode &&
        operationRevisionRef.current === operationRevision
      ) {
        modeBusyRef.current = false;
        setModeBusy(false);
        setModeError("The action could not be completed. Try again.");
      }
    }
  }

  function moveSelection(offset: number): void {
    const currentModeResults = modeResultsRef.current;
    if (activeModeRef.current && currentModeResults.length === 0) return;
    if (!activeModeRef.current && results.length === 0) return;
    if (activeModeRef.current) {
      const currentIndex = Math.max(
        0,
        currentModeResults.findIndex((option) => option.id === activeModeOptionRef.current?.id),
      );
      const nextIndex =
        (currentIndex + offset + currentModeResults.length) % currentModeResults.length;
      setActiveModeOptionId(currentModeResults[nextIndex]?.id);
      return;
    }

    setActiveIndex((current) => {
      const boundedCurrent = Math.min(current, results.length - 1);
      return (boundedCurrent + offset + results.length) % results.length;
    });
  }

  function setSelectionBoundary(boundary: "start" | "end"): void {
    if (activeModeRef.current) {
      const currentModeResults = modeResultsRef.current;
      setActiveModeOptionId(
        currentModeResults[boundary === "start" ? 0 : currentModeResults.length - 1]?.id,
      );
      return;
    }
    setActiveIndex(boundary === "start" ? 0 : Math.max(0, results.length - 1));
  }

  function moveSelectionByPage(direction: -1 | 1): void {
    const currentModeResults = modeResultsRef.current;
    const currentResultCount = activeModeRef.current ? currentModeResults.length : results.length;
    if (currentResultCount === 0) return;
    const resultsElement = resultsRef.current;
    const activeOption = activeResultId ? document.getElementById(activeResultId) : null;
    const pageSize = visibleOptionCount(resultsElement, activeOption, currentResultCount);

    if (activeModeRef.current) {
      const currentIndex = Math.max(
        0,
        currentModeResults.findIndex((option) => option.id === activeModeOptionRef.current?.id),
      );
      const nextIndex = Math.max(
        0,
        Math.min(currentModeResults.length - 1, currentIndex + direction * pageSize),
      );
      setActiveModeOptionId(currentModeResults[nextIndex]?.id);
      return;
    }

    setActiveIndex((current) => {
      const boundedCurrent = Math.min(current, results.length - 1);
      return Math.max(0, Math.min(results.length - 1, boundedCurrent + direction * pageSize));
    });
  }

  const inputValue = activeMode ? modeQuery : query;
  const resultCount = displayedResults.length;

  return (
    <dialog
      aria-label="Quick Actions"
      className="quick-actions"
      data-reader-ignore-shortcuts
      onCancel={modal.onCancel}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      ref={dialogRef}
    >
      <div className="quick-actions__panel">
        <div className="quick-actions__search">
          <Input
            aria-activedescendant={activeResultId}
            aria-autocomplete="list"
            aria-busy={rootBusy || modeBusy || undefined}
            aria-controls={listId}
            aria-expanded="true"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            label={activeMode ? `Search ${activeMode.title}` : "Search Quick Actions"}
            onChange={(event) => {
              if (activeModeRef.current) {
                setModeQuery(event.currentTarget.value);
                setActiveModeOptionId(undefined);
              } else {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveSelection(1);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveSelection(-1);
                return;
              }
              if (event.key === "Home") {
                event.preventDefault();
                setSelectionBoundary("start");
                return;
              }
              if (event.key === "End") {
                event.preventDefault();
                setSelectionBoundary("end");
                return;
              }
              if (event.key === "PageDown" || event.key === "PageUp") {
                event.preventDefault();
                moveSelectionByPage(event.key === "PageDown" ? 1 : -1);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                focusPresentationRuntime.markKeyboardCommand();
                if (activeModeRef.current) void confirmModeOption(activeModeOptionRef.current);
                else void executeRoot(activeCommand);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                dismissPalette();
                return;
              }
              if (
                event.key === "Backspace" &&
                activeModeRef.current &&
                modeQueryRef.current.length === 0
              ) {
                event.preventDefault();
                returnToRoot();
              }
            }}
            placeholder={activeMode?.placeholder ?? "Type a command…"}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={inputValue}
          />
        </div>

        <div className="quick-actions__results" ref={resultsRef}>
          {modeError ? (
            <p className="quick-actions__mode-feedback" role="alert">
              {modeError}
            </p>
          ) : activeMode && modeSnapshot.feedback ? (
            <p
              className="quick-actions__mode-feedback"
              data-tone={modeSnapshot.feedback.tone}
              role={modeSnapshot.feedback.tone === "error" ? "alert" : "status"}
            >
              {modeSnapshot.feedback.message}
            </p>
          ) : activeMode && modeSnapshot.unavailableReason ? (
            <p className="quick-actions__mode-feedback" role="status">
              {modeSnapshot.unavailableReason}
            </p>
          ) : null}
          <div aria-label={activeMode?.title ?? "Available commands"} id={listId} role="listbox">
            {activeMode
              ? modeResults.map((option) => (
                  <ModeOption
                    active={option.id === activeModeOption?.id}
                    committed={option.id === modeSnapshot.committedOptionId}
                    key={option.id}
                    listId={listId}
                    onActivate={() => setActiveModeOptionId(option.id)}
                    onConfirm={() => void confirmModeOption(option)}
                    option={option}
                  />
                ))
              : results.map((command, index) => (
                  <CommandOption
                    active={index === boundedActiveIndex}
                    command={command}
                    keyboard={keyboard}
                    key={command.id}
                    listId={listId}
                    onActivate={() => setActiveIndex(index)}
                    onExecute={() => void executeRoot(command)}
                  />
                ))}
          </div>
          <div
            aria-atomic="true"
            aria-live="polite"
            className={resultCount === 0 ? "quick-actions__empty" : "sr-only"}
            role="status"
          >
            {resultCount === 0 ? (
              <>
                <p>{activeMode ? "No matching options" : "No matching commands"}</p>
                <span>
                  {activeMode ? "Try a shorter search." : "Try a shorter action or destination."}
                </span>
              </>
            ) : (
              `${resultCount} ${activeMode ? (resultCount === 1 ? "option" : "options") : resultCount === 1 ? "command" : "commands"} available.`
            )}
          </div>
        </div>

        <footer className="quick-actions__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> {activeMode ? "Select" : "Run"}
          </span>
          <span>
            <kbd>Esc</kbd> {activeMode ? "Back" : "Close"}
          </span>
        </footer>
      </div>
    </dialog>
  );
}

function CommandOption({
  active,
  command,
  keyboard,
  listId,
  onActivate,
  onExecute,
}: {
  active: boolean;
  command: QuickActionRegistration;
  keyboard: KeyboardPreferences;
  listId: string;
  onActivate: () => void;
  onExecute: () => void;
}) {
  const availability = commandAvailability(command);
  const reasonId = !availability.available
    ? `${optionDomId(listId, command.id)}-reason`
    : undefined;
  const shortcut = formatKeyboardBinding(effectiveKeyboardBinding(command, keyboard));

  return (
    <div
      aria-label={commandOptionName(command, shortcut)}
      aria-describedby={reasonId}
      aria-disabled={!availability.available ? "true" : undefined}
      aria-selected={active}
      className="quick-actions__command"
      data-active={active || undefined}
      id={optionDomId(listId, command.id)}
      onClick={onExecute}
      onMouseEnter={onActivate}
      onPointerDown={(event) => event.preventDefault()}
      role="option"
    >
      <span className="quick-actions__command-copy">
        <strong>
          {command.group}: {command.label}
        </strong>
        {!availability.available ? (
          <span className="quick-actions__command-reason" id={reasonId}>
            {availability.reason}
          </span>
        ) : null}
      </span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </div>
  );
}

function ModeOption({
  active,
  committed,
  listId,
  onActivate,
  onConfirm,
  option,
}: {
  active: boolean;
  committed: boolean;
  listId: string;
  onActivate: () => void;
  onConfirm: () => void;
  option: QuickActionModeOption;
}) {
  const unavailable = option.availability?.available === false;
  const detail =
    option.availability?.available === false ? option.availability.reason : option.status;
  const detailId = detail ? `${optionDomId(listId, option.id)}-detail` : undefined;

  return (
    <div
      aria-describedby={detailId}
      aria-disabled={unavailable ? "true" : undefined}
      aria-label={option.label}
      aria-selected={active}
      className="quick-actions__command"
      data-active={active || undefined}
      data-committed={committed || undefined}
      id={optionDomId(listId, option.id)}
      onClick={onConfirm}
      onMouseEnter={onActivate}
      onPointerDown={(event) => event.preventDefault()}
      role="option"
    >
      <span className="quick-actions__command-copy">
        <strong>{option.label}</strong>
        {detail ? (
          <span className="quick-actions__command-reason" id={detailId}>
            {detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function resolveActiveModeOption(
  options: readonly QuickActionModeOption[],
  activeOptionId: string | undefined,
): QuickActionModeOption | undefined {
  return (
    options.find((option) => option.id === activeOptionId) ??
    options.find((option) => option.availability?.available !== false) ??
    options[0]
  );
}

function isPromiseLike(
  value: Promise<QuickActionPaletteOutcome> | QuickActionPaletteOutcome,
): value is Promise<QuickActionPaletteOutcome> {
  return "then" in value && typeof value.then === "function";
}

function optionDomId(listId: string, optionId: string): string {
  return `${listId}-${optionId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function commandOptionName(command: QuickActionRegistration, shortcut: string | undefined): string {
  const name = `${command.group}: ${command.label}`;
  return shortcut ? `${name}, ${shortcut}` : name;
}

function visibleOptionCount(
  resultsElement: HTMLElement | null,
  activeOption: HTMLElement | null,
  resultCount: number,
): number {
  if (!resultsElement || !activeOption) return Math.min(5, resultCount);
  const optionHeight = activeOption.getBoundingClientRect().height;
  const visibleCount =
    optionHeight > 0 ? Math.floor(resultsElement.clientHeight / optionHeight) : 0;
  return Math.max(1, Math.min(resultCount, visibleCount || 5));
}

function keepOptionVisible(resultsElement: HTMLElement, activeOption: HTMLElement): void {
  const resultsRect = resultsElement.getBoundingClientRect();
  const optionRect = activeOption.getBoundingClientRect();

  if (optionRect.top < resultsRect.top) {
    resultsElement.scrollTop -= resultsRect.top - optionRect.top;
  } else if (optionRect.bottom > resultsRect.bottom) {
    resultsElement.scrollTop += optionRect.bottom - resultsRect.bottom;
  }
}
