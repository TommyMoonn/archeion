import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";

import { focusPresentationRuntime } from "../../app/inputModality";
import { Input } from "../../components/Input";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import type { AppCommand } from "../commands/appCommands";
import {
  effectiveKeyboardBinding,
  formatKeyboardBinding,
  type KeyboardPreferences,
} from "../commands/commandBindings";
import { commandAvailability } from "../commands/commandResolver";
import type { FocusReturnRecord } from "../../utils/focusRestoration";
import {
  createQuickActionIndex,
  searchQuickActions,
  type QuickActionsRegistry,
} from "./quickActions";

type QuickActionsPaletteProps = {
  keyboard: KeyboardPreferences;
  focusReturn?: FocusReturnRecord;
  onClose: () => void;
  onExecute: (command: AppCommand) => void;
  registry: QuickActionsRegistry;
};

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
  const listId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const commandIndex = useMemo(
    () => createQuickActionIndex(snapshot.commands),
    [snapshot.commands],
  );
  const results = useMemo(
    () => searchQuickActions(commandIndex, query, snapshot.recentCommandIds),
    [commandIndex, query, snapshot.recentCommandIds],
  );
  const boundedActiveIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);
  const activeCommand = results[boundedActiveIndex];

  const modal = useModalDialogLifecycle({
    dialogRef,
    focusReturn,
    onClose,
    surfaceKind: "quick-actions",
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const resultsElement = resultsRef.current;
    if (!resultsElement || !activeCommand) return;
    const activeOption = document.getElementById(commandDomId(listId, activeCommand.id));
    if (!activeOption || !resultsElement.contains(activeOption)) return;
    keepOptionVisible(resultsElement, activeOption);
  }, [activeCommand, listId, results]);

  function moveSelection(offset: number): void {
    if (results.length === 0) {
      return;
    }

    setActiveIndex((current) => {
      const boundedCurrent = Math.min(current, results.length - 1);
      return (boundedCurrent + offset + results.length) % results.length;
    });
  }

  function moveSelectionByPage(direction: -1 | 1): void {
    if (results.length === 0) return;
    const resultsElement = resultsRef.current;
    const activeOption = activeCommand
      ? document.getElementById(commandDomId(listId, activeCommand.id))
      : null;
    const pageSize = visibleOptionCount(resultsElement, activeOption, results.length);
    setActiveIndex((current) => {
      const boundedCurrent = Math.min(current, results.length - 1);
      return Math.max(0, Math.min(results.length - 1, boundedCurrent + direction * pageSize));
    });
  }

  function execute(command: AppCommand | undefined): void {
    if (!command || !commandAvailability(command).available) return;
    modal.suppressFocusRestoration();
    onExecute(command);
  }

  return (
    <dialog
      aria-label="Quick Actions"
      className="quick-actions"
      data-reader-ignore-shortcuts
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <div className="quick-actions__panel">
        <div className="quick-actions__search">
          <Input
            aria-activedescendant={
              activeCommand ? commandDomId(listId, activeCommand.id) : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            label="Search Quick Actions"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
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
                setActiveIndex(0);
                return;
              }

              if (event.key === "End") {
                event.preventDefault();
                setActiveIndex(Math.max(0, results.length - 1));
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
                execute(activeCommand);
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
            placeholder="Type a command"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>

        <div className="quick-actions__results" ref={resultsRef}>
          <div aria-label="Available commands" id={listId} role="listbox">
            {results.length > 0
              ? results.map((command, index) => {
                  const isActive = index === boundedActiveIndex;
                  const availability = commandAvailability(command);
                  const reasonId = !availability.available
                    ? `${commandDomId(listId, command.id)}-reason`
                    : undefined;
                  const shortcut = formatKeyboardBinding(
                    effectiveKeyboardBinding(command, keyboard),
                  );

                  return (
                    <div
                      aria-label={commandOptionName(command, shortcut)}
                      aria-describedby={reasonId}
                      aria-disabled={!availability.available ? "true" : undefined}
                      aria-selected={isActive}
                      className="quick-actions__command"
                      data-active={isActive || undefined}
                      id={commandDomId(listId, command.id)}
                      key={command.id}
                      onClick={() => execute(command)}
                      onMouseEnter={() => setActiveIndex(index)}
                      onPointerDown={(event) => event.preventDefault()}
                      role="option"
                    >
                      <span className="quick-actions__command-copy">
                        <strong>
                          {command.group}: {command.label}
                        </strong>
                        {!availability.available ? (
                          <span id={reasonId}>{availability.reason}</span>
                        ) : null}
                      </span>
                      {shortcut ? <kbd>{shortcut}</kbd> : null}
                    </div>
                  );
                })
              : null}
          </div>
          <div
            aria-atomic="true"
            aria-live="polite"
            className={results.length === 0 ? "quick-actions__empty" : "sr-only"}
            role="status"
          >
            {results.length === 0 ? (
              <>
                <p>No matching commands</p>
                <span>Try a shorter action or destination.</span>
              </>
            ) : (
              `${results.length} ${results.length === 1 ? "command" : "commands"} available.`
            )}
          </div>
        </div>

        <footer className="quick-actions__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Run
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </div>
    </dialog>
  );
}

function commandDomId(listId: string, commandId: string): string {
  return `${listId}-${commandId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function commandOptionName(command: AppCommand, shortcut: string | undefined): string {
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
