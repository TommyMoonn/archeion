import { Skeleton } from "./ui/skeleton";

export function CollectionLoading({
  message,
  cover = false,
}: {
  message: string;
  cover?: boolean;
}) {
  return (
    <div
      className="collection-content__loading flex flex-col items-center gap-collection-loading text-muted text-body"
      role="status"
    >
      {cover ? <Skeleton aria-hidden="true" className="library-loading__cover" /> : null}
      <span>{message}</span>
    </div>
  );
}
