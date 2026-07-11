import { createContext, useContext, useEffect } from "react";

import type { QuickActionCommand } from "./quickActions";

export type QuickActionsContextValue = {
  openPalette: () => void;
  openSettings: () => void;
  preloadSettings: () => void;
  registerCommands: (sourceId: string, commands: readonly QuickActionCommand[]) => () => void;
};

const fallbackContext: QuickActionsContextValue = {
  openPalette: () => undefined,
  openSettings: () => undefined,
  preloadSettings: () => undefined,
  registerCommands: () => () => undefined,
};

export const QuickActionsContext = createContext<QuickActionsContextValue>(fallbackContext);

export function useQuickActions(): Pick<
  QuickActionsContextValue,
  "openPalette" | "openSettings" | "preloadSettings"
> {
  const context = useContext(QuickActionsContext);
  return {
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
