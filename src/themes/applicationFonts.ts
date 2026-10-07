import type { AppearanceSettings } from "../types/appSettings";
import { normalizeApplicationFontFamily } from "../types/applicationFonts";

// CSS owns the exact foundation stacks. Aliases keep runtime fallbacks in sync
// without duplicating the type system in JavaScript.
export const DEFAULT_INTERFACE_FONT_STACK = "var(--font-ui-default)";
export const DEFAULT_DISPLAY_FONT_STACK = "var(--font-display-default)";

function resolveSystemStack(family: string, families: readonly string[], fallback: string): string {
  const label = normalizeApplicationFontFamily(family);
  if (!label || !families.some((installed) => installed.toLowerCase() === label.toLowerCase())) {
    return fallback;
  }
  // Always use a CSS string, never an identifier or raw stylesheet insertion.
  const quoted = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${quoted}", ${fallback}`;
}

export function resolveApplicationFontStacks(
  appearance: Pick<AppearanceSettings, "interfaceFont" | "displayFont">,
  installedFamilies: readonly string[],
): Readonly<{ interface: string; display: string }> {
  const interfaceStack =
    appearance.interfaceFont.kind === "system"
      ? resolveSystemStack(
          appearance.interfaceFont.family,
          installedFamilies,
          DEFAULT_INTERFACE_FONT_STACK,
        )
      : DEFAULT_INTERFACE_FONT_STACK;
  const displayStack =
    appearance.displayFont.kind === "interface"
      ? interfaceStack
      : appearance.displayFont.kind === "system"
        ? resolveSystemStack(
            appearance.displayFont.family,
            installedFamilies,
            DEFAULT_DISPLAY_FONT_STACK,
          )
        : DEFAULT_DISPLAY_FONT_STACK;
  return { interface: interfaceStack, display: displayStack };
}

export function applyApplicationFontStacks(
  root: HTMLElement,
  appearance: AppearanceSettings,
  families: readonly string[],
): void {
  const stacks = resolveApplicationFontStacks(appearance, families);
  root.style.setProperty("--font-ui", stacks.interface);
  root.style.setProperty("--font-display", stacks.display);
}
