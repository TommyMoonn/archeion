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
    <section aria-label="Diagnostic details" className="epub-issue-details">
      <ol className="epub-issue-details__list">
        {issues.map((issue, index) => {
          const error = issue.severity === "error";
          const Icon = error ? CircleAlert : TriangleAlert;
          return (
            <li
              className="epub-issue-detail"
              data-issue-code={issue.code}
              data-severity={issue.severity}
              key={`${issue.code}:${issue.resourcePath ?? ""}:${index}`}
            >
              <span className="epub-issue-detail__severity">
                <Icon aria-hidden="true" size={17} />
                {error ? "Error" : "Warning"}
              </span>
              <p>{epubDiagnosticIssueMessage(issue)}</p>
              {issue.resourcePath ? (
                <dl className="epub-issue-detail__context">
                  <div>
                    <dt>EPUB resource</dt>
                    <dd>
                      <code>{issue.resourcePath}</code>
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
