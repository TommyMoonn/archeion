import { RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";

export function LibraryIntegrityHeader({
  kind,
  refreshing,
  pending = false,
  onRefresh,
  resultLabel,
}: {
  kind: "duplicates" | "epub-issues";
  refreshing: boolean;
  pending?: boolean;
  onRefresh: () => Promise<boolean>;
  resultLabel: string;
}) {
  const title = kind === "duplicates" ? "Duplicates" : "EPUB Issues";
  return (
    <header className={`library-header ${kind}-header`}>
      <div className="library-header__title">
        <p className="eyebrow">Archive integrity</p>
        <h1 id={`${kind}-title`}>{title}</h1>
      </div>
      <div className={`${kind}-header__actions`}>
        <Button
          busy={refreshing}
          disabled={refreshing || pending}
          icon={<RefreshCw />}
          onClick={() => void onRefresh()}
          size="standard"
          variant="secondary"
        >
          Refresh
        </Button>
      </div>
      <div className={`library-controls ${kind}-controls`}>
        <span aria-live="polite" className="library-result-count">
          {resultLabel}
        </span>
      </div>
    </header>
  );
}
