import { useSyncExternalStore } from "react";

import type { AppearancePreviewContext, AppearanceRuntime } from "../../themes/AppearanceRuntime";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";

export type CommittedAppearanceSource = Pick<AppearanceRuntime, "getPreviewContext" | "subscribe">;

export function useCommittedArchiveAppearance(
  source: CommittedAppearanceSource = appearanceRuntime,
): AppearancePreviewContext | null {
  return useSyncExternalStore(source.subscribe, source.getPreviewContext, source.getPreviewContext);
}
