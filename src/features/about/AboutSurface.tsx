import { BookOpenText, ExternalLink, GitFork, Globe, History } from "lucide-react";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ComponentProps,
} from "react";

import { openExternalUrl } from "../../app/openExternalUrl";
import { Alert } from "../../components/ui/alert";
import {
  AboutLayout,
  AboutLinkCopy,
  aboutLinkListClassName,
  aboutLinkRowClassName,
} from "./AboutLayout";
import { AboutLayoutContext } from "./aboutLayoutContext";
import { AboutUpdateStatus } from "../updates/AboutUpdateStatus";
import { CHANGELOG_URL } from "../updates/updateReleaseUrl";

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
    location: "Archeion documentation",
  },
  {
    href: CHANGELOG_URL,
    icon: History,
    label: "Changelog",
    location: "Release history",
  },
  {
    href: "https://github.com/TommyMoonn/archeion",
    icon: GitFork,
    label: "Source code",
    location: "github.com/TommyMoonn/archeion",
  },
] as const;

type AboutSurfaceProps = { updateClient?: ComponentProps<typeof AboutUpdateStatus>["client"] };

export function AboutSurface(props: AboutSurfaceProps) {
  const layout = useContext(AboutLayoutContext);
  return layout ? (
    <AboutSurfaceContent {...props} />
  ) : (
    <AboutLayout>
      <AboutSurfaceContent {...props} />
    </AboutLayout>
  );
}

function AboutSurfaceContent({ updateClient }: AboutSurfaceProps) {
  const [externalLinkError, setExternalLinkError] = useState<string | null>(null);
  const linkOperationRef = useRef(0);

  useEffect(() => {
    return () => {
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
    <>
      <AboutUpdateStatus client={updateClient} />

      <nav aria-label="Archeion links" className={aboutLinkListClassName}>
        {ABOUT_DESTINATIONS.map(({ href, icon: DestinationIcon, label, location }) => (
          <a
            className={`grid w-full grid-cols-about-link items-center gap-about-link-column bg-transparent text-start text-text no-underline transition-background control-hover:bg-surface-hover control-hover:text-text-strong focus-visible:bg-surface-hover focus-visible:text-text-strong keyboard-navigation:focus-visible:outline-offset-2! ${aboutLinkRowClassName}`}
            href={href}
            key={href}
            onClick={(event) => openDestination(event, href)}
            rel="noreferrer"
            target="_blank"
          >
            <DestinationIcon aria-hidden="true" className="size-icon-glyph-standard text-muted" />
            <AboutLinkCopy label={label} location={location} />
            <ExternalLink aria-hidden="true" className="size-icon-glyph-compact text-muted" />
          </a>
        ))}
      </nav>

      {externalLinkError ? (
        <Alert
          className="w-full wrap-normal text-meta text-error-strong forced-colors:text-error-strong!"
          data-tone="error"
        >
          {externalLinkError}
        </Alert>
      ) : null}
    </>
  );
}
