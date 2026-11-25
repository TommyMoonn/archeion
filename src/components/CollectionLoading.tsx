import { Spinner } from "./ui/spinner";

export function CollectionLoading({ message }: { message: string }) {
  return (
    <Spinner
      aria-label={message}
      className="collection-content__loading size-6 stroke-2 text-muted"
      data-visible
    />
  );
}
