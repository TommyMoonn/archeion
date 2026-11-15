import { useEffect, useState } from "react";

// Start static so server output, hydration and script-free reading agree.
export function useLandingMotion(pointer = false) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const media = matchMedia(
      pointer
        ? "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)"
        : "(prefers-reduced-motion: no-preference)",
    );
    const update = () => setEnabled(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [pointer]);
  return enabled;
}
