import type { ThemeManifestV1 } from "../../../src/themes/domain";

// Authorable schema-v1 colors, shared by offline and rendered-shell contracts.
// The quiet divider and interaction colors must come from the real resolver.
export const shellStressThemes = {
  equal: {
    schemaVersion: 1,
    id: "shell-equal",
    name: "Equal shell planes",
    base: "dark",
    app: { frame: "#202020", sidebar: "#202020", main: "#202020", lineStrong: "#aaaaaa" },
  },
  distinct: {
    schemaVersion: 1,
    id: "shell-distinct",
    name: "Distinct shell planes",
    base: "dark",
    app: { frame: "#481830", sidebar: "#123c38", main: "#22284e", lineStrong: "#aaaaaa" },
  },
} as const satisfies Readonly<Record<"equal" | "distinct", ThemeManifestV1>>;
