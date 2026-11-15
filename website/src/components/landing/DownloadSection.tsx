import { DownloadActions } from "./DownloadAction";

export function DownloadSection() {
  return (
    <section
      id="download"
      tabIndex={-1}
      aria-labelledby="download-title"
      className="scroll-mt-22 border-0 border-t border-solid border-border-subtle px-8 pt-16 pb-22 text-center landing-mobile:px-5"
    >
      <span id="get-started" tabIndex={-1} className="block scroll-mt-22" />
      <h2
        id="download-title"
        className="mx-auto mb-0 max-w-hero-copy font-display text-hero font-normal tracking-display text-content-strong"
      >
        Download Archeion for Windows.
      </h2>
      <p className="mt-5 mb-7 text-base text-content-muted">
        Open an existing EPUB folder to start browsing.
      </p>
      <DownloadActions closing />
    </section>
  );
}
