import { UtilityWindowLoadStatus } from "../../components/UtilityWindowLoadStatus";
import { useUtilityWindowLoadState } from "../../components/useUtilityWindowLoadState";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { ThemeManagerSurface, type ThemeManagerServices } from "./ThemeManagerSurface";

const initializePreferences = () => appPreferencesStore.initialize();

type ThemeManagerWindowProps = Readonly<{
  services?: ThemeManagerServices;
}>;

export function ThemeManagerWindow({ services }: ThemeManagerWindowProps = {}) {
  const initializationState = useUtilityWindowLoadState(initializePreferences);

  return (
    <div
      className="utility-window-ready"
      data-utility-ready={initializationState === "ready" || undefined}
    >
      {initializationState !== "ready" ? (
        <UtilityWindowLoadStatus title="Theme Manager" state={initializationState} />
      ) : null}
      {initializationState === "ready" ? <ThemeManagerSurface services={services} /> : null}
    </div>
  );
}
