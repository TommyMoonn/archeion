import { createContext, useContext, useEffect } from "react";

import type { KeyboardInteractionContext } from "../commands/appCommands";
import type { KeyboardBinding } from "../commands/commandBindings";
import type { QuickActionRegistration } from "./quickActions";

export type QuickActionsContextValue = {
  getCommandBinding: (commandId: string) => KeyboardBinding | undefined;
  handleKeyboardEvent: (event: KeyboardEvent, context?: KeyboardInteractionContext) => boolean;
  openPalette: () => void;
  openSettings: () => void;
  registerCommands: (sourceId: string, commands: readonly QuickActionRegistration[]) => () => void;
};

const fallbackContext: QuickActionsContextValue = {
  getCommandBinding: () => undefined,
  handleKeyboardEvent: () => false,
  openPalette: () => undefined,
  openSettings: () => undefined,
  registerCommands: () => () => undefined,
};

export const QuickActionsContext = createContext<QuickActionsContextValue>(fallbackContext);

export function useQuickActions(): Pick<
  QuickActionsContextValue,
  "getCommandBinding" | "handleKeyboardEvent" | "openPalette" | "openSettings"
> {
  const context = useContext(QuickActionsContext);
  return {
    getCommandBinding: context.getCommandBinding,
    handleKeyboardEvent: context.handleKeyboardEvent,
    openPalette: context.openPalette,
    openSettings: context.openSettings,
  };
}

export function useRegisterQuickActions(
  sourceId: string,
  commands: readonly QuickActionRegistration[],
): void {
  const context = useContext(QuickActionsContext);
  useEffect(() => context.registerCommands(sourceId, commands), [commands, context, sourceId]);
}
