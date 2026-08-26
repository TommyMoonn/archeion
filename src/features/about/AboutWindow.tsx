import { useEffect } from "react";

import { ABOUT_MAIN_CONTENT_ID, SkipLink } from "../../components/SkipLink";
import { WindowTitlebar } from "../../components/WindowTitlebar";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { AboutSurface } from "./AboutSurface";

export function AboutWindow() {
  useEffect(() => {
    void appPreferencesStore
      .initialize()
      .catch((error) => console.error("About preferences could not be loaded", error));
  }, []);

  return (
    <div className="window-app window-app--about">
      <SkipLink targetId={ABOUT_MAIN_CONTENT_ID} />
      <WindowTitlebar canMaximize={false} />
      <div className="window-app__content">
        <main className="about-window-shell" id={ABOUT_MAIN_CONTENT_ID} tabIndex={-1}>
          <section className="about-window">
            <AboutSurface />
          </section>
        </main>
      </div>
    </div>
  );
}
