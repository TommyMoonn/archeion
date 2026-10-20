import { ARCHIVE_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";
import { UtilityWindowLoadStatus } from "../../components/UtilityWindowLoadStatus";
import { useUtilityWindowLoadState } from "../../components/useUtilityWindowLoadState";
import { ArchiveManagerTitlebarComposition } from "./ArchiveManagerTitlebarComposition";

export function ArchiveManagerWindowLoading({ failed = false }: { failed?: boolean }) {
  const loadState = useUtilityWindowLoadState();
  const state = failed ? "error" : loadState;
  return (
    <main
      aria-busy={state === "loading" || undefined}
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
            <div className="archive-manager-window__fallback">
              <h1>Archive Manager</h1>
              <UtilityWindowLoadStatus title="Archive Manager" state={state} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
