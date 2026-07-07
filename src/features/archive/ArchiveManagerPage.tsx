import { useNavigate } from "react-router-dom";

import { ArchiveManagerWindowContent } from "./ArchiveManagerWindowContent";
import { useArchive } from "./useArchive";

export function ArchiveManagerPage() {
  const archive = useArchive();
  const navigate = useNavigate();

  return (
    <ArchiveManagerWindowContent
      mode="manager"
      onArchiveActivated={() => void navigate("/")}
      onBack={() => void navigate("/")}
      state={archive}
    />
  );
}
