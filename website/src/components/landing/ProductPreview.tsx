import { usePointerDecoration } from "./usePointerDecoration";

export function ProductPreview() {
  const { target, onPointerMove, onPointerLeave } = usePointerDecoration("preview");
  return (
    <section
      aria-label="Archeion application preview"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="mx-auto max-w-site px-8 pb-16 landing-mobile:px-4 landing-mobile:pb-11"
    >
      <div ref={target}>
        {/* B3.3 replaces this existing public preview with the approved 1480×906 image. */}
        <img
          src="/archeion/assets/archeion-preview.png"
          alt="Archeion Library showing an EPUB collection, folders, search, filters, and book covers."
          width={1544}
          height={1012}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="block h-auto w-full rounded-card border border-solid border-border"
        />
      </div>
    </section>
  );
}
