import darkLogo from "../assets/brand/archeion-logo-dark.png";
import lightLogo from "../assets/brand/archeion-logo-light.png";

/** Decorative logo next to the existing product-name heading. */
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`} aria-hidden="true">
      <img className="brand-logo__dark" src={darkLogo} alt="" draggable={false} />
      <img className="brand-logo__light" src={lightLogo} alt="" draggable={false} />
    </span>
  );
}
