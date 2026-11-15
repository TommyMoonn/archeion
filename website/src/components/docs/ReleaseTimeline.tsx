import { Link as LinkIcon } from "lucide-react";
import useBrokenLinks from "@docusaurus/useBrokenLinks";
import { releases } from "@/data/releaseHistory";
import type { ReleaseInline } from "../../../../scripts/release-history-markdown.mjs";

function Inline({ nodes }: { nodes: ReleaseInline[] }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "code":
        return (
          <code
            key={index}
            className="rounded bg-surface-sunken px-1.25 py-0.5 font-mono text-docs-code text-content-strong"
          >
            {node.value}
          </code>
        );
      case "strong":
        return (
          <strong key={index} className="font-bold text-content-strong">
            <Inline nodes={node.children} />
          </strong>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            className="text-accent underline underline-offset-3 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <Inline nodes={node.children} />
          </a>
        );
    }
  });
}

export function ReleaseTimeline() {
  const { collectAnchor } = useBrokenLinks();
  for (const release of releases) collectAnchor(release.id);
  return (
    <ol
      aria-label="Releases, newest first"
      role="list"
      className="relative mt-6.5 mb-0 list-none border-0 border-s border-solid border-border-strong ps-6"
    >
      {releases.map((release) => (
        <li
          key={release.version}
          className="relative m-0 grid grid-cols-[var(--spacing-release-metadata)_minmax(0,1fr)] gap-5.5 pb-8 ps-0 docs-narrow:grid-cols-1 docs-narrow:gap-2 docs-narrow:pb-6.25"
        >
          <span
            aria-hidden="true"
            className="absolute top-1.75 -start-7.25 size-2.25 box-content rounded-full border-2 border-solid border-accent bg-surface"
          />
          <div>
            <h2
              id={release.id}
              tabIndex={-1}
              className="group mt-0 mb-1.25 scroll-mt-24 font-sans text-docs-release font-bold tracking-tight text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              v{release.version}
              <a
                data-copy-exclude
                href={`#${release.id}`}
                aria-label={`Link to v${release.version}`}
                className="ms-1 inline-flex size-6 items-center justify-center align-middle text-content-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-focus-ring pointer-coarse:opacity-100"
              >
                <LinkIcon aria-hidden="true" className="size-3.5" />
              </a>
            </h2>
            <time
              dateTime={release.date}
              className="block text-docs-release-date text-content-subtle"
            >
              {release.dateLabel}
            </time>
          </div>
          <div className="min-w-0">
            <ul className="mt-0 mb-4.5 list-disc ps-6">
              {release.items.map((nodes, index) => (
                <li key={index} className="my-2.25 ps-1 marker:text-content-subtle">
                  <Inline nodes={nodes} />
                </li>
              ))}
            </ul>
            <p className="m-0">
              <a
                href={`https://github.com/TommyMoonn/archeion/releases/tag/v${release.version}`}
                className="inline-flex items-center gap-1.25 text-caption font-semibold text-accent underline underline-offset-3 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
              >
                Full release notes for v{release.version} <span aria-hidden="true">↗</span>
              </a>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
