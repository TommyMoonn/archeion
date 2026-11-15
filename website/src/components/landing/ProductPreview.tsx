import { usePointerDecoration } from "./usePointerDecoration";

export function ProductPreview() {
  const { target, onPointerMove, onPointerLeave } = usePointerDecoration("preview");
  return (
    <section
      aria-label="Archeion application preview"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="pb-16 landing-mobile:pb-11"
    >
      <div
        ref={target}
        className="mx-auto w-landing-content landing-tablet:w-landing-media-tablet landing-mobile:w-landing-media-mobile"
      >
        <img
          src="/archeion/assets/images/landing-library.png"
          alt="Archeion Library showing an EPUB collection, folders, search, filters, and book covers."
          width={1480}
          height={906}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="block h-auto w-full rounded-xl border border-solid border-landing-preview-border shadow-landing-preview landing-mobile:rounded-card landing-pointer:hover:shadow-landing-preview-hover"
        />
      </div>
    </section>
  );
}
