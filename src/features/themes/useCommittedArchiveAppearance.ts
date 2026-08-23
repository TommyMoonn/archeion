import { useSyncExternalStore } from "react";

import type {
  AppearanceRuntime,
  LegacyAppearancePreviewContext,
} from "../../themes/AppearanceRuntime";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";

export type CommittedAppearanceSource = Pick<
  AppearanceRuntime,
  "getLegacyPreviewContext" | "subscribe"
>;

export function useCommittedArchiveAppearance(
  source: CommittedAppearanceSource = appearanceRuntime,
): LegacyAppearancePreviewContext | null {
  return useSyncExternalStore(
    source.subscribe,
    source.getLegacyPreviewContext,
    source.getLegacyPreviewContext,
  );
}
