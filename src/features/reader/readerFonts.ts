import atkinsonLatin400ItalicUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400-italic.woff2";
import atkinsonLatin400NormalUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400-normal.woff2";
import atkinsonLatin700ItalicUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-700-italic.woff2";
import atkinsonLatin700NormalUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-700-normal.woff2";
import atkinsonLatinExtended400ItalicUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-ext-400-italic.woff2";
import atkinsonLatinExtended400NormalUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-ext-400-normal.woff2";
import atkinsonLatinExtended700ItalicUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-ext-700-italic.woff2";
import atkinsonLatinExtended700NormalUrl from "../../assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-ext-700-normal.woff2";
import literataLatinExtendedItalicUrl from "../../assets/fonts/literata/literata-latin-ext-standard-italic.woff2";
import literataLatinExtendedNormalUrl from "../../assets/fonts/literata/literata-latin-ext-standard-normal.woff2";
import literataLatinItalicUrl from "../../assets/fonts/literata/literata-latin-standard-italic.woff2";
import literataLatinNormalUrl from "../../assets/fonts/literata/literata-latin-standard-normal.woff2";
import literataVietnameseItalicUrl from "../../assets/fonts/literata/literata-vietnamese-standard-italic.woff2";
import literataVietnameseNormalUrl from "../../assets/fonts/literata/literata-vietnamese-standard-normal.woff2";
import { normalizeReaderFontFamily, type ReaderFontFamily } from "../../types/reader";

type ReaderFontOption = {
  label: string;
  value: ReaderFontFamily;
};

type ReaderFontFace = {
  sourceUrl: string;
  style: "italic" | "normal";
  unicodeRange: string;
  weight: number | `${number} ${number}`;
};

type ReaderFontDefinition = {
  fallbackFamily: string;
  faces?: readonly ReaderFontFace[];
  fontFamilyName?: string;
  id: ReaderFontFamily;
  label: string;
};

const latinUnicodeRange =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const latinExtendedUnicodeRange =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const vietnameseUnicodeRange =
  "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";

const literataFaces = [
  {
    sourceUrl: literataVietnameseNormalUrl,
    style: "normal",
    unicodeRange: vietnameseUnicodeRange,
    weight: "200 900",
  },
  {
    sourceUrl: literataLatinExtendedNormalUrl,
    style: "normal",
    unicodeRange: latinExtendedUnicodeRange,
    weight: "200 900",
  },
  {
    sourceUrl: literataLatinNormalUrl,
    style: "normal",
    unicodeRange: latinUnicodeRange,
    weight: "200 900",
  },
  {
    sourceUrl: literataVietnameseItalicUrl,
    style: "italic",
    unicodeRange: vietnameseUnicodeRange,
    weight: "200 900",
  },
  {
    sourceUrl: literataLatinExtendedItalicUrl,
    style: "italic",
    unicodeRange: latinExtendedUnicodeRange,
    weight: "200 900",
  },
  {
    sourceUrl: literataLatinItalicUrl,
    style: "italic",
    unicodeRange: latinUnicodeRange,
    weight: "200 900",
  },
] satisfies readonly ReaderFontFace[];

const atkinsonFaces = [
  {
    sourceUrl: atkinsonLatinExtended400NormalUrl,
    style: "normal",
    unicodeRange: latinExtendedUnicodeRange,
    weight: 400,
  },
  {
    sourceUrl: atkinsonLatin400NormalUrl,
    style: "normal",
    unicodeRange: latinUnicodeRange,
    weight: 400,
  },
  {
    sourceUrl: atkinsonLatinExtended700NormalUrl,
    style: "normal",
    unicodeRange: latinExtendedUnicodeRange,
    weight: 700,
  },
  {
    sourceUrl: atkinsonLatin700NormalUrl,
    style: "normal",
    unicodeRange: latinUnicodeRange,
    weight: 700,
  },
  {
    sourceUrl: atkinsonLatinExtended400ItalicUrl,
    style: "italic",
    unicodeRange: latinExtendedUnicodeRange,
    weight: 400,
  },
  {
    sourceUrl: atkinsonLatin400ItalicUrl,
    style: "italic",
    unicodeRange: latinUnicodeRange,
    weight: 400,
  },
  {
    sourceUrl: atkinsonLatinExtended700ItalicUrl,
    style: "italic",
    unicodeRange: latinExtendedUnicodeRange,
    weight: 700,
  },
  {
    sourceUrl: atkinsonLatin700ItalicUrl,
    style: "italic",
    unicodeRange: latinUnicodeRange,
    weight: 700,
  },
] satisfies readonly ReaderFontFace[];

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
    faces: literataFaces,
    fallbackFamily: '"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    fontFamilyName: "Literata",
    id: "literata",
    label: "Literata",
  },
  {
    faces: atkinsonFaces,
    fallbackFamily: '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif',
    fontFamilyName: "Atkinson Hyperlegible",
    id: "atkinson",
    label: "Atkinson Hyperlegible",
  },
];

export const readerTypefaceOptions = readerFontDefinitions.map(({ id, label }) => ({
  label,
  value: id,
})) satisfies ReaderFontOption[];

export function readerFontFamilyForId(fontFamily: unknown): string {
  const definition = readerFontDefinitionForId(fontFamily);
  return definition.fallbackFamily;
}

export function readerFontFaceCssForId(fontFamily: unknown): string {
  const { faces, fontFamilyName } = readerFontDefinitionForId(fontFamily);

  if (!fontFamilyName || !faces) {
    return "";
  }

  return faces.map((face) => createFontFaceCss(fontFamilyName, face)).join("\n\n");
}

function readerFontDefinitionForId(fontFamily: unknown): ReaderFontDefinition {
  const normalizedFontFamily = normalizeReaderFontFamily(fontFamily);
  return (
    readerFontDefinitions.find((font) => font.id === normalizedFontFamily) ??
    readerFontDefinitions[0]
  );
}

function createFontFaceCss(fontFamilyName: string, face: ReaderFontFace): string {
  return `@font-face {
  font-family: ${JSON.stringify(fontFamilyName)};
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: swap;
  src: url(${JSON.stringify(face.sourceUrl)}) format("woff2");
  unicode-range: ${face.unicodeRange};
}`;
}
