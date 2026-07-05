import { FolderOpen } from "@phosphor-icons/react";

import { OpenVaultButton } from "./OpenVaultButton";

type VaultStatusBarProps = {
  path: string;
};

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function VaultStatusBar({ path }: VaultStatusBarProps) {
  return (
    <div className="vault-status">
      <FolderOpen aria-hidden="true" size={17} />
      <div className="vault-status__copy">
        <span>{folderName(path)}</span>
        <code title={path}>{path}</code>
      </div>
      <OpenVaultButton label="Change" variant="ghost" />
    </div>
  );
}
