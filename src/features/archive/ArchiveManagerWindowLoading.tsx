import { ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";

export function ArchiveManagerWindowLoading() {
  return (
    <main
      aria-busy="true"
      className="archive-manager-shell"
      id={ARCHIVE_MANAGER_MAIN_CONTENT_ID}
      tabIndex={-1}
    >
      <div className="archive-manager-window__fallback" role="status">
        <h1>Archive Manager</h1>
        <span className="archive-loading">Opening Archive Manager</span>
      </div>
    </main>
  );
}
