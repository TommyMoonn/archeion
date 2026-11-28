import { useEffect, useState } from "react";
import { AboutSurface } from "../../../src/features/about/AboutSurface";
import { aboutWindowShellClassName } from "../../../src/features/about/AboutLayout";
import { WindowTitlebar } from "../../../src/components/WindowTitlebar";
import { ABOUT_MAIN_CONTENT_ID } from "../../../src/components/SkipLink";
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
      <WindowTitlebar canMaximize={false} utility />
      <div className="window-app__content">
        <main className={aboutWindowShellClassName} id={ABOUT_MAIN_CONTENT_ID} tabIndex={-1}>
          <AboutSurface updateClient={fixture.client} />
        </main>
      </div>
    </div>
  );
}
