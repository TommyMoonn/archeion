// Synthetic selection roles, not claims about fonts installed on the CI host.
// Real glyph metrics are reviewed separately in the Windows runtime matrix.
export const representativeFamilies = ["Fixture Sans", "Fixture Wide Serif", "Fixture Mono"];
export const largeFontCatalog = [
  ...representativeFamilies,
  ...Array.from({ length: 1200 }, (_, index) => `Catalog Family ${String(index).padStart(4, "0")}`),
];
