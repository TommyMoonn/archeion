import { FolderOpen } from "@phosphor-icons/react";

import { Button } from "../../../components/Button";
import { SettingsRow } from "../SettingsRow";

type ArchivesSettingsSectionProps = {
  archivePath?: string;
  hidden: boolean;
  onOpenArchiveManager: () => void;
  onRevealArchiveFolder: () => void;
};

export function ArchivesSettingsSection({
  archivePath,
  hidden,
  onOpenArchiveManager,
  onRevealArchiveFolder,
}: ArchivesSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Archives</h2>
      </header>
      <SettingsRow
        description="The active archive root on disk."
        label="Current archive folder"
        note={archivePath ? <code>{archivePath}</code> : "No archive selected"}
      >
        <Button
          disabled={!archivePath}
          icon={<FolderOpen aria-hidden="true" size={17} />}
          onClick={onRevealArchiveFolder}
          variant="secondary"
        >
          Reveal in folder
        </Button>
      </SettingsRow>
      <SettingsRow
        description="Manage archive switching, naming, and removal."
        label="Archive Manager"
      >
        <Button onClick={onOpenArchiveManager} variant="secondary">
          Open Archive Manager
        </Button>
      </SettingsRow>
    </section>
  );
}
