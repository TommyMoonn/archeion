import rawIllustrationImageContract from "../../../shared/illustration-image-contract.json";

export type EpubIllustrationMediaType = string;

export type EpubIllustrationImageType = Readonly<{
  extensions: readonly string[];
  label: string;
  mediaType: EpubIllustrationMediaType;
  preferredExtension: string;
}>;

export type EpubIllustrationImageContract = Readonly<{
  maximumBytes: number;
  types: readonly EpubIllustrationImageType[];
}>;

export const EPUB_ILLUSTRATION_IMAGE_CONTRACT = parseIllustrationImageContract(
  rawIllustrationImageContract,
);
export const EPUB_ILLUSTRATION_MAX_BYTES = EPUB_ILLUSTRATION_IMAGE_CONTRACT.maximumBytes;
export const EPUB_ILLUSTRATION_IMAGE_TYPES = EPUB_ILLUSTRATION_IMAGE_CONTRACT.types;

const IMAGE_TYPE_BY_MEDIA_TYPE = new Map(
  EPUB_ILLUSTRATION_IMAGE_TYPES.map((type) => [type.mediaType, type] as const),
);

export function epubIllustrationImageType(
  mediaType: string,
): EpubIllustrationImageType | undefined {
  const normalized = mediaType.split(";", 1)[0]?.trim().toLowerCase();
  return IMAGE_TYPE_BY_MEDIA_TYPE.get(normalized);
}

export function epubIllustrationFileExtension(
  path: string,
  imageType: EpubIllustrationImageType,
): string | undefined {
  const fileName = path.replaceAll("\\", "/").split("/").pop() ?? "";
  const separator = fileName.lastIndexOf(".");
  if (separator <= 0 || separator === fileName.length - 1) return undefined;
  const extension = fileName.slice(separator + 1).toLowerCase();
  return imageType.extensions.includes(extension) ? extension : undefined;
}

export function epubIllustrationExportFileName(href: string, mediaType: string): string {
  const imageType = epubIllustrationImageType(mediaType);
  if (!imageType) throw new Error("This illustration type cannot be saved.");

  const extension = epubIllustrationFileExtension(href, imageType);
  const fileName = href.replaceAll("\\", "/").split("/").pop() ?? "";
  if (!extension) return `illustration.${imageType.preferredExtension}`;

  const stem = fileName.slice(0, -(extension.length + 1));
  const sanitizedStem = sanitizeIllustrationFileStem(stem);
  return sanitizedStem
    ? `${sanitizedStem}.${extension}`
    : `illustration.${imageType.preferredExtension}`;
}

function sanitizeIllustrationFileStem(value: string): string | null {
  const normalized = Array.from(value.normalize("NFC"))
    .map((character) => (isUnsafeFileNameCharacter(character) ? "-" : character))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[ .-]+|[ .-]+$/g, "");
  if (!normalized || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
    return null;
  }

  return (
    Array.from(normalized)
      .slice(0, 120)
      .join("")
      .replace(/[ .-]+$/g, "") || null
  );
}

function isUnsafeFileNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f || '<>:"/\\|?*'.includes(character);
}

function parseIllustrationImageContract(value: unknown): EpubIllustrationImageContract {
  if (
    !isRecord(value) ||
    typeof value.maximumBytes !== "number" ||
    !Number.isSafeInteger(value.maximumBytes) ||
    value.maximumBytes <= 0
  ) {
    throw new Error("The illustration image contract has an invalid maximum byte count.");
  }
  if (!Array.isArray(value.types) || value.types.length !== 5) {
    throw new Error("The illustration image contract must define exactly five image types.");
  }

  const mediaTypes = new Set<string>();
  const extensionOwners = new Map<string, string>();
  const types = value.types.map((entry): EpubIllustrationImageType => {
    if (
      !isRecord(entry) ||
      typeof entry.mediaType !== "string" ||
      !entry.mediaType ||
      typeof entry.label !== "string" ||
      !entry.label ||
      typeof entry.preferredExtension !== "string" ||
      !Array.isArray(entry.extensions) ||
      entry.extensions.length === 0 ||
      !entry.extensions.every(isContractExtension)
    ) {
      throw new Error("The illustration image contract contains an invalid image type.");
    }
    if (mediaTypes.has(entry.mediaType)) {
      throw new Error(`The illustration image contract repeats ${entry.mediaType}.`);
    }
    mediaTypes.add(entry.mediaType);

    const extensions = Object.freeze([...entry.extensions]);
    if (new Set(extensions).size !== extensions.length) {
      throw new Error(
        `The illustration image contract repeats an extension for ${entry.mediaType}.`,
      );
    }
    if (!extensions.includes(entry.preferredExtension)) {
      throw new Error(
        `The illustration image contract has an invalid preferred extension for ${entry.mediaType}.`,
      );
    }
    for (const extension of extensions) {
      const owner = extensionOwners.get(extension);
      if (owner && owner !== entry.mediaType) {
        throw new Error(`The illustration image contract assigns .${extension} to two types.`);
      }
      extensionOwners.set(extension, entry.mediaType);
    }

    return Object.freeze({
      extensions,
      label: entry.label,
      mediaType: entry.mediaType as EpubIllustrationMediaType,
      preferredExtension: entry.preferredExtension,
    });
  });

  return Object.freeze({ maximumBytes: value.maximumBytes, types: Object.freeze(types) });
}

function isContractExtension(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
