import type { ArchiveCommandClient } from "../tauri/archiveCommandClient";
import { AnnotationRepository, type ArchiveAnnotationSnapshot } from "./AnnotationRepository";

export async function loadArchiveAnnotationSnapshot(
  commands: ArchiveCommandClient,
  archiveId: string,
  rootPath: string,
): Promise<ArchiveAnnotationSnapshot> {
  const { library, annotations, activationRevision } = await commands.invoke(
    "load_archive_annotation_snapshot",
    { archiveId },
    rootPath,
  );
  return { activationRevision, books: AnnotationRepository.snapshot(library, annotations) };
}
