import { UtilityWindowLoadStatus } from "../../components/UtilityWindowLoadStatus";
import { useUtilityWindowLoadState } from "../../components/useUtilityWindowLoadState";
import {
  ArchiveManagerLayout,
  archiveFallbackClassName,
  archiveFallbackHeadingClassName,
  archiveFallbackMessageClassName,
} from "./ArchiveManagerLayout";

export function ArchiveManagerWindowLoading({ failed = false }: { failed?: boolean }) {
  const loadState = useUtilityWindowLoadState();
  const state = failed ? "error" : loadState;
  return (
    <ArchiveManagerLayout busy={state === "loading"}>
      {state === "loading" ? (
        <div className="absolute inset-0">
          <UtilityWindowLoadStatus title="Archive Manager" state={state} />
        </div>
      ) : (
        <div className={archiveFallbackClassName}>
          <h1 className={archiveFallbackHeadingClassName}>Archive Manager</h1>
          <UtilityWindowLoadStatus
            title="Archive Manager"
            state={state}
            errorMessageClassName={archiveFallbackMessageClassName}
          />
        </div>
      )}
    </ArchiveManagerLayout>
  );
}
