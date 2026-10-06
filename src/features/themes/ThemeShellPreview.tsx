import { useId } from "react";

import type { ResolvedAppTheme } from "../../themes/domain";
import { ThemeShellGraphic } from "./ThemeShellGraphic";

type ThemeShellPreviewProps = Readonly<{ theme: ResolvedAppTheme }>;

export function ThemeShellPreview({ theme }: ThemeShellPreviewProps) {
  const id = useId();
  const captionId = `${id}-caption`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="theme-shell-preview">
      <figcaption id={captionId}>Application shell preview</figcaption>
      <p className="sr-only" id={descriptionId}>
        Representative window chrome above navigation and workspace planes, separated by a quiet
        divider, with a raised content surface. This preview is not interactive.
      </p>
      <ThemeShellGraphic captionId={captionId} descriptionId={descriptionId} theme={theme} />
    </figure>
  );
}
