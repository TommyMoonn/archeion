import darkLogo from "../assets/brand/archeion-logo-dark.png";
import lightLogo from "../assets/brand/archeion-logo-light.png";

/** Decorative logo next to the existing product-name heading. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo grid ${className}`} aria-hidden="true">
      <img
        className="brand-logo__dark block col-start-1 row-start-1 size-full object-contain app-light:hidden"
        src={darkLogo}
        alt=""
        draggable={false}
      />
      <img
        className="brand-logo__light hidden col-start-1 row-start-1 size-full object-contain app-light:block"
        src={lightLogo}
        alt=""
        draggable={false}
      />
    </span>
  );
}
