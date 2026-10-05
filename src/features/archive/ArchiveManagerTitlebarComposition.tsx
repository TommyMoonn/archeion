import { WindowTitlebarAppActions } from "../../components/WindowTitlebar";

export function ArchiveManagerTitlebarComposition() {
  return (
    <WindowTitlebarAppActions presentation="split">
      <div className="archive-manager-titlebar-composition" data-tauri-drag-region />
    </WindowTitlebarAppActions>
  );
}
