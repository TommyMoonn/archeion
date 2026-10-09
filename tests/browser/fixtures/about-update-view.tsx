import { useEffect, useState } from "react";
import { AboutSurface } from "../../../src/features/about/AboutSurface";
import { WindowTitlebar } from "../../../src/components/WindowTitlebar";
import { createUpdateToastFixture } from "./update-toast-backend";

export function AboutUpdateFixture() {
  const [fixture] = useState(() => createUpdateToastFixture());
  useEffect(() => {
    window.updateToastFixture = fixture;
    return () => {
      delete window.updateToastFixture;
      fixture.client.dispose();
    };
  }, [fixture]);
  return (
    <div className="window-app window-app--about">
      <WindowTitlebar canMaximize={false} />
      <div className="window-app__content">
        <main className="about-window-shell" tabIndex={-1}>
          <AboutSurface updateClient={fixture.client} />
        </main>
      </div>
    </div>
  );
}
