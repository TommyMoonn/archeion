const WINDOWS_INVALID_NAME_PATTERN = /[<>:"/\\|?*]/;
const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function validateArchiveName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return "Archive name is required.";
  }

  if (name.trimEnd() !== name || trimmed.endsWith(".")) {
    return "Archive name cannot end with a space or period.";
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "Archive name cannot contain path separators.";
  }

  if (WINDOWS_INVALID_NAME_PATTERN.test(trimmed)) {
    return "Archive name contains characters Windows cannot use in folder names.";
  }

  if ([...trimmed].some((character) => character < " ")) {
    return "Archive name cannot contain control characters.";
  }

  if (trimmed.toLowerCase() === ".archeion") {
    return "Archive name cannot be .archeion.";
  }

  const reservedName = trimmed.split(".", 1)[0]?.toLowerCase() ?? "";
  if (RESERVED_WINDOWS_NAMES.has(reservedName)) {
    return "Archive name is reserved on Windows.";
  }

  return null;
}

export function normalizeArchiveName(name: string): string {
  return name.trim();
}

export function deriveArchivePath(parentPath: string, archiveName: string): string {
  const name = normalizeArchiveName(archiveName);
  if (!parentPath || !name) {
    return "";
  }

  const separator = parentPath.includes("\\") ? "\\" : "/";
  const trimmedParent = parentPath.replace(/[\\/]+$/, "");
  return `${trimmedParent}${separator}${name}`;
}
