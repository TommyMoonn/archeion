import { DownloadActions } from "./DownloadAction";

export function DownloadSection() {
  return (
    <section
      id="download"
      tabIndex={-1}
      aria-labelledby="download-title"
      className="scroll-mt-22 landing-mobile:scroll-mt-18 border-0 border-t border-solid border-landing-divider pt-16 pb-22 text-center landing-mobile:pt-12 landing-mobile:pb-16"
    >
      <span
        id="get-started"
        tabIndex={-1}
        className="block scroll-mt-22 landing-mobile:scroll-mt-18"
      />
      <div className="mx-auto w-landing-content landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow">
        <h2
          id="download-title"
          className="mx-auto mb-0 max-w-landing-title font-display text-landing-hero leading-[1.08] landing-mobile:text-landing-cta-mobile text-balance font-normal tracking-display text-content-strong"
        >
          Download Archeion for Windows.
        </h2>
        <p className="mx-auto mt-4.5 mb-7 max-w-[58ch] text-base leading-[1.65] text-content-muted">
          Open an existing EPUB folder to start browsing.
        </p>
        <DownloadActions closing />
      </div>
    </section>
  );
}
