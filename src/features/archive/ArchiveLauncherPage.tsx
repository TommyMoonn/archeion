import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";

type ArchiveLauncherPageProps = {
  state: Exclude<ArchiveState, { status: "ready" }>;
};

export function ArchiveLauncherPage({ state }: ArchiveLauncherPageProps) {
  return <ArchiveManagerWindowContent mode="launcher" state={state} />;
}
