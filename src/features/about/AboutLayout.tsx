import { useEffect, useState, type ReactNode } from "react";
import { APPLICATION_VERSION_FALLBACK, resolveApplicationVersion } from "../../app/appVersion";
import { BrandLogo } from "../../components/BrandLogo";
import {
  UtilityWindowLoading,
  UtilityWindowLoadStatus,
} from "../../components/UtilityWindowLoadStatus";

import { AboutLayoutContext } from "./aboutLayoutContext";

export const aboutWindowShellClassName =
  "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain scrollbar-gutter-both-edges bg-surface-main";
export const aboutLinkListClassName = "grid w-full gap-control-gap";
export const aboutLinkRowClassName = "min-h-about-link rounded-control p-control-gap";

export function AboutLinkCopy({ label, location }: { label: string; location: string }) {
  return (
    <span className="grid min-w-0 gap-about-link-copy">
      <strong className="text-body-only font-medium text-text">{label}</strong>
      <small className="wrap-anywhere text-caption text-muted">{location}</small>
    </span>
  );
}

export function AboutLoading({ failed = false }: { failed?: boolean }) {
  return (
    <>
      {failed ? (
        <UtilityWindowLoadStatus title="About Archeion" state="error" />
      ) : (
        <UtilityWindowLoading title="About Archeion" />
      )}
      <div aria-hidden="true" className={aboutLinkListClassName}>
        {Array.from({ length: 4 }, (_, index) => (
          <span className={`block bg-surface-raised ${aboutLinkRowClassName}`} key={index}>
            <AboutLinkCopy label={"\u00a0"} location={"\u00a0"} />
          </span>
        ))}
      </div>
    </>
  );
}

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
      <div className="mx-auto grid min-h-full w-full max-w-about content-center justify-items-center gap-about-inset px-about-inset py-about-block about-narrow:px-about-inline-narrow text-center">
        <header
          className="grid justify-items-center gap-about-identity"
          data-utility-slot="identity"
        >
          <BrandLogo className="size-about-logo" />
          <div className="grid max-w-about-copy gap-control-gap">
            <h1 className="m-0 font-app-display text-page-title text-text-strong" id="about-title">
              Archeion
            </h1>
            <p className="m-0 text-meta-only font-medium text-muted">Version {version}</p>
          </div>
        </header>
        <div
          className="grid w-full min-w-0 justify-items-center gap-about-inset [&>[data-utility-stage]]:min-h-about-status [&>[data-utility-stage]]:justify-items-center!"
          data-utility-slot="about-content"
        >
          {children}
        </div>
      </div>
    </AboutLayoutContext.Provider>
  );
}
