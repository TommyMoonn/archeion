import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";

import { Input } from "../../components/Input";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import {
  effectiveKeyboardBinding,
  formatKeyboardBinding,
  type KeyboardPreferences,
} from "./commandBindings";
import { commandAvailability } from "./commandResolver";
import {
  createQuickActionIndex,
  searchQuickActions,
  type QuickActionCommand,
  type QuickActionsRegistry,
} from "./quickActions";

type QuickActionsPaletteProps = {
  keyboard: KeyboardPreferences;
  onClose: () => void;
  onExecute: (command: QuickActionCommand) => void;
  registry: QuickActionsRegistry;
  returnFocusTo?: HTMLElement | null;
};

export function QuickActionsPalette({
  keyboard,
  onClose,
  onExecute,
  registry,
  returnFocusTo,
}: QuickActionsPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    onClose,
    returnFocusTo,
    surfaceKind: "quick-actions",
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!activeCommand) {
      return;
    }

    document.getElementById(commandDomId(listId, activeCommand.id))?.scrollIntoView({
      block: "nearest",
    });
  }, [activeCommand, listId]);

  function moveSelection(offset: number): void {
    if (results.length === 0) {
      return;
    }

    setActiveIndex((current) => (current + offset + results.length) % results.length);
  }

  function execute(command: QuickActionCommand | undefined): void {
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

              if (event.key === "Enter") {
                event.preventDefault();
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

        <div
          aria-label="Available commands"
          className="quick-actions__results"
          id={listId}
          role="listbox"
        >
          {results.length > 0 ? (
            results.map((command, index) => {
              const isActive = index === boundedActiveIndex;
              const availability = commandAvailability(command);
              const reasonId = !availability.available
                ? `${commandDomId(listId, command.id)}-reason`
                : undefined;
              const shortcut = formatKeyboardBinding(effectiveKeyboardBinding(command, keyboard));

              return (
                <button
                  aria-describedby={reasonId}
                  aria-disabled={!availability.available ? "true" : undefined}
                  aria-selected={isActive}
                  className="quick-actions__command"
                  data-active={isActive || undefined}
                  id={commandDomId(listId, command.id)}
                  key={command.id}
                  onClick={() => execute(command)}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  type="button"
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
                </button>
              );
            })
          ) : (
            <div aria-live="polite" className="quick-actions__empty" role="status">
              <p>No matching commands</p>
              <span>Try a shorter action or destination.</span>
            </div>
          )}
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
