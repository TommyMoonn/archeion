import { archiveTree } from "./content";

export function ArchiveSection() {
  return (
    <section
      id="files"
      tabIndex={-1}
      aria-labelledby="files-title"
      className="-scroll-mt-3 landing-mobile:scroll-mt-4 border-0 border-t border-solid border-landing-divider py-26 landing-mobile:py-18"
    >
      <span
        id="local-first"
        tabIndex={-1}
        className="block scroll-mt-22 landing-mobile:scroll-mt-18"
      />
      <div className="mx-auto w-landing-content landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow grid grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] items-center gap-landing-archive-gap landing-menu:grid-cols-1 landing-menu:gap-8.5">
        <div className="min-w-0 max-w-[520px]">
          <h2
            id="files-title"
            className="mb-5 max-w-landing-archive-heading font-display text-section leading-[1.06] landing-mobile:text-landing-section-mobile landing-mobile:leading-[1.06] text-balance font-normal tracking-display text-content-strong"
          >
            Your EPUB files stay in their folders.
          </h2>
          <p className="mb-0 max-w-prose text-base leading-[1.7] text-content-muted">
            Archeion opens the folders you choose. Your books stay where they are, while library
            details and reading progress are saved alongside them.
          </p>
        </div>
        <div
          role="img"
          aria-label="Example archive containing EPUB books, a series folder, and Archeion's local library, reading progress, cover, and backup data."
          className="min-w-0 overflow-x-auto rounded-card border border-solid border-border bg-surface-sunken px-5.5 py-5 landing-mobile:px-3.5 landing-mobile:py-4.5"
        >
          <pre
            aria-hidden="true"
            className="m-0 overflow-visible bg-transparent p-0 font-mono text-caption leading-normal landing-mobile:text-landing-tree-mobile text-content-muted"
          >
            <code className="border-0 bg-transparent p-0 text-inherit">
              {archiveTree
                .split(/(Your Archive\/|Series\/|\.archeion\/|covers\/|backups\/)/)
                .map((part, index) => (
                  <span
                    key={index}
                    className={
                      index === 1
                        ? "font-semibold text-content-strong"
                        : /^(Series|\.archeion|covers|backups)\/$/.test(part)
                          ? "text-accent"
                          : undefined
                    }
                  >
                    {part}
                  </span>
                ))}
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}
