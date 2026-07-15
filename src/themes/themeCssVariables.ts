import type { CSSProperties } from "react";

import type { ResolvedAppTheme, ResolvedReaderTheme } from "./domain";
import {
  appThemeResolvedTokenRegistry,
  readerThemeResolvedTokenRegistry,
} from "./themeTokenRegistry";

export type ReaderThemeCssProperties = CSSProperties & Record<`--${string}`, string>;

export function applyResolvedAppTheme(root: HTMLElement, theme: ResolvedAppTheme): void {
  for (const definition of Object.values(appThemeResolvedTokenRegistry)) {
    root.style.removeProperty(definition.cssVariable);
  }

  root.dataset.appTheme = theme.base;

  for (const [token, definition] of Object.entries(appThemeResolvedTokenRegistry)) {
    root.style.setProperty(
      definition.cssVariable,
      theme.tokens[token as keyof typeof appThemeResolvedTokenRegistry],
    );
  }
}

export function readerThemeCssProperties(theme: ResolvedReaderTheme): ReaderThemeCssProperties {
  const properties: Record<`--${string}`, string> = {};

  for (const [token, definition] of Object.entries(readerThemeResolvedTokenRegistry)) {
    properties[definition.cssVariable] =
      theme.tokens[token as keyof typeof readerThemeResolvedTokenRegistry];
  }

  return properties;
}
