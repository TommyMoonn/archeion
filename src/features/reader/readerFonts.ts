import { normalizeReaderFontFamily, type ReaderFontFamily } from "../../types/reader";

type ReaderFontOption = {
  label: string;
  value: ReaderFontFamily;
};

type ReaderFontDefinition = {
  fallbackFamily: string;
  fontFaceCss?: string;
  id: ReaderFontFamily;
  label: string;
};

export const readerFontDefinitions: readonly ReaderFontDefinition[] = [
  {
    fallbackFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    id: "serif",
    label: "Book serif",
  },
  {
    fallbackFamily: '"Segoe UI", Arial, sans-serif',
    id: "sans",
    label: "Clean sans",
  },
  {
    fallbackFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    id: "system",
    label: "System",
  },
  {
    fallbackFamily: '"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    fontFaceCss: `
@font-face {
  font-family: "Literata";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: local("Literata"), local("Literata Regular");
}
`,
    id: "literata",
    label: "Literata",
  },
  {
    fallbackFamily: '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif',
    fontFaceCss: `
@font-face {
  font-family: "Atkinson Hyperlegible";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: local("Atkinson Hyperlegible"), local("Atkinson Hyperlegible Regular");
}
`,
    id: "atkinson",
    label: "Atkinson Hyperlegible",
  },
];

export const readerTypefaceOptions = readerFontDefinitions.map(({ id, label }) => ({
  label,
  value: id,
})) satisfies ReaderFontOption[];

export function readerFontFamilyForId(fontFamily: unknown): string {
  const normalizedFontFamily = normalizeReaderFontFamily(fontFamily);
  return (
    readerFontDefinitions.find((font) => font.id === normalizedFontFamily)?.fallbackFamily ??
    readerFontDefinitions[0].fallbackFamily
  );
}

export function readerFontFaceCssForId(fontFamily: unknown): string {
  const normalizedFontFamily = normalizeReaderFontFamily(fontFamily);
  return (
    readerFontDefinitions.find((font) => font.id === normalizedFontFamily)?.fontFaceCss?.trim() ??
    ""
  );
}
