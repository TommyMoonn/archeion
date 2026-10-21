import { useEffect } from "react";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { AboutSurface } from "./AboutSurface";

export function AboutWindow() {
  useEffect(() => {
    void appPreferencesStore
      .initialize()
      .catch((error) => console.error("About preferences could not be loaded", error));
  }, []);

  return (
    <div className="utility-window-ready" data-utility-ready="true">
      <AboutSurface />
    </div>
  );
}
