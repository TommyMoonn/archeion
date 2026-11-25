import { CircleAlert, TriangleAlert } from "lucide-react";

import type { EpubDiagnostics } from "../../types/epubIntegrity";

type EpubDiagnosticIssue = EpubDiagnostics["issues"][number];

function input(issue: EpubDiagnosticIssue, key: string): string | undefined {
  const value = issue.messageInputs?.[key]?.trim();
  return value || undefined;
}

function namedResource(prefix: string, issue: EpubDiagnosticIssue): string {
  const manifestId = input(issue, "manifestId");
  return manifestId ? `${prefix} "${manifestId}"` : prefix;
}

function epubDiagnosticIssueMessage(issue: EpubDiagnosticIssue): string {
  switch (issue.code) {
    case "unreadable-zip":
      return "The EPUB archive could not be opened.";
    case "inspection-limit-exceeded":
      return "Inspection stopped after reaching a safety limit.";
    case "missing-container":
      return "The EPUB container document is missing.";
    case "malformed-container":
      return "The EPUB container document is malformed.";
    case "missing-rootfile":
      return "The container does not identify a package document.";
    case "unsafe-rootfile":
      return "The package document path is unsafe.";
    case "missing-package-document":
      return "The package document is missing.";
    case "malformed-package-document":
      return "The package document is malformed.";
    case "spine-manifest-item-missing":
      return `${namedResource("Reading order item", issue)} is not present in the manifest.`;
    case "unsafe-reading-resource":
      return `${namedResource("Reading resource", issue)} resolves outside the EPUB archive.`;
    case "reading-resource-missing":
      return `${namedResource("Reading resource", issue)} is missing.`;
    case "unsupported-reading-resource": {
      const mediaType = input(issue, "mediaType");
      return mediaType
        ? `${namedResource("Reading resource", issue)} uses the unsupported media type "${mediaType}".`
        : `${namedResource("Reading resource", issue)} uses an unsupported media type.`;
    }
    case "encrypted-reading-resource":
      return `${namedResource("Reading resource", issue)} is encrypted and cannot be opened.`;
    case "no-usable-reading-order":
      return "The EPUB does not contain a usable reading order.";
    case "navigation-resource-missing":
      return `${namedResource("Navigation resource", issue)} is missing.`;
    case "navigation-resource-unusable": {
      const mediaType = input(issue, "mediaType");
      return mediaType
        ? `${namedResource("Navigation resource", issue)} uses the unexpected media type "${mediaType}".`
        : `${namedResource("Navigation resource", issue)} cannot be used.`;
    }
    case "broken-local-document-target": {
      const href = input(issue, "href");
      return href
        ? `The local link "${href}" points to a missing document.`
        : "A local link points to a missing document.";
    }
    case "unsafe-local-link-target": {
      const href = input(issue, "href");
      return href
        ? `The local link "${href}" resolves outside the EPUB archive.`
        : "A local link resolves outside the EPUB archive.";
    }
    case "invalid-local-link-target": {
      const href = input(issue, "href");
      return href
        ? `The local link "${href}" cannot be opened by Reader.`
        : "A local link cannot be opened by Reader.";
    }
    case "readable-document-unusable":
      return "A reading-order document could not be inspected for local links.";
  }
}

export function EpubIssueDetails({ issues }: Readonly<{ issues: EpubDiagnostics["issues"] }>) {
  return (
    <section
      aria-label="Diagnostic details"
      className="epub-issue-details py-integrity-gap px-integrity-header-inline"
    >
      <ol className="epub-issue-details__list grid gap-control-gap m-0 p-0 list-none">
        {issues.map((issue, index) => {
          const error = issue.severity === "error";
          const Icon = error ? CircleAlert : TriangleAlert;
          return (
            <li
              className="epub-issue-detail grid grid-cols-[var(--spacing-integrity-row-gap)_minmax(0,1fr)] items-start gap-y-control-gap-compact gap-x-integrity-row-block min-w-0 py-integrity-alert-block px-integrity-row-block border-standard border-solid border-line rounded-control bg-integrity-detail group/issue"
              data-issue-code={issue.code}
              data-severity={issue.severity}
              key={`${issue.code}:${issue.resourcePath ?? ""}:${index}`}
            >
              <span
                className={`epub-issue-detail__severity inline-flex items-center self-center justify-self-center text-warning leading-[0] group-data-[severity=error]/issue:text-error ${issue.resourcePath ? "row-span-2" : ""}`}
              >
                <Icon aria-hidden="true" size={17} />
                <span className="sr-only">{error ? "Error" : "Warning"}</span>
              </span>
              <p className="m-0 text-text text-body-only wrap-anywhere">
                {epubDiagnosticIssueMessage(issue)}
              </p>
              {issue.resourcePath ? (
                <dl className="epub-issue-detail__context col-start-2 min-w-0 m-0">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-control-gap [@media(max-width:680px)]:grid-cols-1 [@media(max-width:680px)]:gap-control-inset">
                    <dt className="text-muted text-caption-size">EPUB resource</dt>
                    <dd className="min-w-0 m-0 wrap-anywhere text-muted text-caption-size">
                      <code className="font-mono">{issue.resourcePath}</code>
                    </dd>
                  </div>
                </dl>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
