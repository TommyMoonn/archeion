import { BookOpenText, ExternalLink, GitFork, Globe } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { APPLICATION_VERSION_FALLBACK, resolveApplicationVersion } from "../../app/appVersion";
import { openExternalUrl } from "../../app/openExternalUrl";
import archeionIcon from "../../assets/brand/archeion-icon-128.png";

const ABOUT_DESTINATIONS = [
  {
    href: "https://tommymoonn.github.io/archeion/",
    icon: Globe,
    label: "Website",
    location: "tommymoonn.github.io/archeion",
  },
  {
    href: "https://tommymoonn.github.io/archeion/documentation/",
    icon: BookOpenText,
    label: "Documentation",
    location: "tommymoonn.github.io/archeion/documentation",
  },
  {
    href: "https://github.com/TommyMoonn/archeion",
    icon: GitFork,
    label: "Source code",
    location: "github.com/TommyMoonn/archeion",
  },
] as const;

export function AboutSurface() {
  const [version, setVersion] = useState(APPLICATION_VERSION_FALLBACK);
  const [externalLinkError, setExternalLinkError] = useState<string | null>(null);
  const linkOperationRef = useRef(0);

  useEffect(() => {
    let active = true;
    void resolveApplicationVersion().then((resolvedVersion) => {
      if (active) setVersion(resolvedVersion);
    });

    return () => {
      active = false;
      linkOperationRef.current += 1;
    };
  }, []);

  function openDestination(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    const operation = ++linkOperationRef.current;
    setExternalLinkError(null);
    void openExternalUrl(href).catch(() => {
      if (linkOperationRef.current === operation) {
        setExternalLinkError("Archeion could not open that link.");
      }
    });
  }

  return (
    <div className="about-window__content">
      <div className="about-window__brand" aria-hidden="true">
        <img alt="" src={archeionIcon} />
      </div>

      <div className="about-window__copy">
        <h1 id="about-title">Archeion</h1>
        <p className="about-window__version">Version {version}</p>
      </div>

      <nav aria-label="Archeion links" className="about-window__links">
        {ABOUT_DESTINATIONS.map(({ href, icon: DestinationIcon, label, location }) => (
          <a
            className="about-window__link"
            href={href}
            key={href}
            onClick={(event) => openDestination(event, href)}
            rel="noreferrer"
            target="_blank"
          >
            <DestinationIcon aria-hidden="true" size={20} />
            <span className="about-window__link-copy">
              <strong>{label}</strong>
              <small>{location}</small>
            </span>
            <ExternalLink aria-hidden="true" size={18} strokeWidth={2.25} />
          </a>
        ))}
      </nav>

      {externalLinkError ? (
        <p className="about-window__error" data-tone="error" role="alert">
          {externalLinkError}
        </p>
      ) : null}
    </div>
  );
}
