import { ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";
import { ArchiveManagerTitlebarComposition } from "./ArchiveManagerTitlebarComposition";

export function ArchiveManagerWindowLoading() {
  return (
    <main
      aria-busy="true"
      className="archive-manager-shell"
      id={ARCHIVE_MANAGER_MAIN_CONTENT_ID}
      tabIndex={-1}
    >
      <ArchiveManagerTitlebarComposition />
      <div className="archive-manager-window">
        <div className="archive-manager-window__body">
          <aside
            aria-hidden="true"
            className="archive-manager-window__sidebar archive-manager-window__sidebar--fallback"
          />
          <section className="archive-manager-window__main">
            <div className="archive-manager-window__fallback" role="status">
              <h1>Archive Manager</h1>
              <span className="archive-loading">Opening Archive Manager</span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
