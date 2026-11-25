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
      <div
        className={`${kind}-header__actions self-center justify-self-end [@media(max-width:680px)]:col-span-full [@media(max-width:680px)]:justify-self-stretch [@media(max-width:680px)]:[&>.button]:w-full`}
      >
        <Button
          className="[&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
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
      <div
        className={`library-controls ${kind}-controls gap-integrity-row-gap [@media(max-width:680px)]:items-start [@media(max-width:680px)]:flex-col [@media(max-width:680px)]:gap-integrity-small-gap [@media(max-width:680px)]:py-integrity-controls-block`}
      >
        <span aria-live="polite" className="library-result-count">
          {resultLabel}
        </span>
      </div>
    </header>
  );
}
