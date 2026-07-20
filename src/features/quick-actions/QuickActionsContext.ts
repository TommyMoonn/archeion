import { createContext, useContext, useEffect } from "react";

import type { KeyboardBinding } from "./commandBindings";
import type { KeyboardInteractionContext } from "./commandResolver";
import type { QuickActionCommand } from "./quickActions";

export type QuickActionsContextValue = {
  getCommandBinding: (commandId: string) => KeyboardBinding | undefined;
  handleKeyboardEvent: (event: KeyboardEvent, context?: KeyboardInteractionContext) => boolean;
  openPalette: () => void;
  openSettings: () => void;
  preloadSettings: () => void;
  registerCommands: (sourceId: string, commands: readonly QuickActionCommand[]) => () => void;
};

const fallbackContext: QuickActionsContextValue = {
  getCommandBinding: () => undefined,
  handleKeyboardEvent: () => false,
  openPalette: () => undefined,
  openSettings: () => undefined,
  preloadSettings: () => undefined,
  registerCommands: () => () => undefined,
};

export const QuickActionsContext = createContext<QuickActionsContextValue>(fallbackContext);

export function useQuickActions(): Pick<
  QuickActionsContextValue,
  "getCommandBinding" | "handleKeyboardEvent" | "openPalette" | "openSettings" | "preloadSettings"
> {
  const context = useContext(QuickActionsContext);
  return {
    getCommandBinding: context.getCommandBinding,
    handleKeyboardEvent: context.handleKeyboardEvent,
    openPalette: context.openPalette,
    openSettings: context.openSettings,
    preloadSettings: context.preloadSettings,
  };
}

export function useRegisterQuickActions(
  sourceId: string,
  commands: readonly QuickActionCommand[],
): void {
  const context = useContext(QuickActionsContext);
  useEffect(() => context.registerCommands(sourceId, commands), [commands, context, sourceId]);
}
