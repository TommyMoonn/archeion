import { invoke } from "@tauri-apps/api/core";
import type { AppThemeSelection } from "../types/settings";
import type { ResolvedAppTheme } from "./domain";
import shellPalettes from "./appShellPalettes.json" with { type: "json" };

export type AppearancePresentation = Readonly<{
  selection: AppThemeSelection;
  base: "dark" | "light";
  settingsRevision: number;
  background: string;
  foreground: string;
  manifestSource: string | null;
}>;

/** Opaque canvas for the interval without a document; no second theme resolver. */
function composite(color: string, background: string): string {
  if (color.length === 7) return color;
  const alpha = parseInt(color.slice(7, 9), 16) / 255;
  return (
    "#" +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          parseInt(color.slice(offset, offset + 2), 16) * alpha +
            parseInt(background.slice(offset, offset + 2), 16) * (1 - alpha),
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function applicationPresentation(
  selection: AppThemeSelection,
  settingsRevision: number,
  theme: ResolvedAppTheme,
  manifestSource: string | null,
): AppearancePresentation {
  const canvas = composite(theme.tokens.canvas, shellPalettes[theme.base].background);
  const background = composite(theme.tokens.main, canvas);
  return Object.freeze({
    selection,
    settingsRevision,
    base: theme.base,
    background,
    foreground: composite(theme.tokens.text, background),
    manifestSource,
  });
}

export function publishAppearancePresentation(presentation: AppearancePresentation): Promise<void> {
  return invoke("prepare_app_appearance", { presentation });
}
