import { useEffect, useState, type ReactNode } from "react";
import { APPLICATION_VERSION_FALLBACK, resolveApplicationVersion } from "../../app/appVersion";
import archeionIcon from "../../assets/brand/archeion-icon-128.png";

import { AboutLayoutContext } from "./aboutLayoutContext";

export function AboutLayout({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(APPLICATION_VERSION_FALLBACK);
  useEffect(() => {
    let active = true;
    void resolveApplicationVersion().then((value) => {
      if (active) setVersion(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <AboutLayoutContext.Provider value>
      <div className="about-window__content">
        <header className="about-window__identity" data-utility-slot="identity">
          <div className="about-window__brand" aria-hidden="true">
            <img alt="" src={archeionIcon} />
          </div>
          <div className="about-window__copy">
            <h1 id="about-title">Archeion</h1>
            <p className="about-window__version">Version {version}</p>
          </div>
        </header>
        <div className="about-window__body" data-utility-slot="about-content">
          {children}
        </div>
      </div>
    </AboutLayoutContext.Provider>
  );
}
