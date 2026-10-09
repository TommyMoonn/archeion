export const CHANGELOG_URL = "https://tommymoonn.github.io/archeion/documentation/changelog/";

export function updateReleaseUrl(version: string): string {
  // Updater metadata is not allowed to supply an arbitrary link destination.
  return /^\d+\.\d+\.\d+$/.test(version)
    ? `${CHANGELOG_URL}#release-${version.replaceAll(".", "-")}`
    : CHANGELOG_URL;
}
