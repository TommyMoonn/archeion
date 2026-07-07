export type KnownArchive = {
  id: string;
  displayName: string;
  rootPath: string;
  lastOpenedAt: string;
  createdAt: string;
};

export type ArchiveRegistry = {
  version: number;
  archives: KnownArchive[];
  lastOpenedArchiveId?: string | null;
};

export function activeArchiveFromRegistry(
  registry: ArchiveRegistry,
): KnownArchive | null {
  if (!registry.lastOpenedArchiveId) {
    return null;
  }

  return (
    registry.archives.find(
      (archive) => archive.id === registry.lastOpenedArchiveId,
    ) ?? null
  );
}
