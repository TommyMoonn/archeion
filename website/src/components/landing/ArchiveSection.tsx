import { archiveTree } from "./content";

export function ArchiveSection() {
  return (
    <section
      id="files"
      tabIndex={-1}
      aria-labelledby="files-title"
      className="scroll-mt-22 border-0 border-t border-solid border-border-subtle px-8 py-24 landing-mobile:px-5 landing-mobile:py-18"
    >
      <span id="local-first" tabIndex={-1} className="block scroll-mt-22" />
      <div className="mx-auto grid max-w-site grid-cols-2 items-center gap-16 landing-menu:grid-cols-1 landing-menu:gap-8">
        <div>
          <h2
            id="files-title"
            className="mb-5 font-display text-section font-normal tracking-display text-content-strong"
          >
            Your EPUB files stay in their folders.
          </h2>
          <p className="mb-0 max-w-prose text-base leading-relaxed text-content-muted">
            Archeion opens the folders you choose. Your books stay where they are, while library
            details and reading progress are saved alongside them.
          </p>
        </div>
        <div
          role="img"
          aria-label="Example archive containing EPUB books, a series folder, and Archeion's local library, reading progress, cover, and backup data."
          className="min-w-0 overflow-x-auto rounded-card border border-solid border-border bg-surface-sunken px-5 py-5"
        >
          <pre
            aria-hidden="true"
            className="m-0 overflow-visible bg-transparent p-0 font-mono text-xs leading-relaxed text-content-muted"
          >
            <code className="border-0 bg-transparent p-0 text-inherit">{archiveTree}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
