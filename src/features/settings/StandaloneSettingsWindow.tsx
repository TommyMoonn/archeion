import { UtilityWindowLoadStatus } from "../../components/UtilityWindowLoadStatus";
import { useUtilityWindowLoadState } from "../../components/useUtilityWindowLoadState";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import { SettingsSurface } from "./SettingsSurface";
import { useSettingsArchiveMaintenance } from "./useSettingsArchiveMaintenance";

const initializePreferences = () => appPreferencesStore.initialize();

export function SettingsWindow() {
  const archiveBoundary = useSettingsArchiveMaintenance();
  const initializationState = useUtilityWindowLoadState(initializePreferences);

  return (
    <div
      className="utility-window-ready"
      data-utility-ready={initializationState === "ready" || undefined}
    >
      {initializationState !== "ready" ? (
        <UtilityWindowLoadStatus title="Settings" state={initializationState} />
      ) : null}
      {initializationState === "ready" ? (
        <QuickActionsProvider>
          <SettingsSurface archiveBoundary={archiveBoundary} />
        </QuickActionsProvider>
      ) : null}
    </div>
  );
}
