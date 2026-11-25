import { Skeleton } from "../../components/ui/skeleton";

export function ReaderOpeningStatus() {
  return (
    <div className="reader-loading">
      <Skeleton aria-hidden="true" className="reader-loading__line" />
      <Skeleton aria-hidden="true" className="reader-loading__line reader-loading__line--short" />
      <span role="status">Opening book</span>
    </div>
  );
}
