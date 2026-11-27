import { useContext, useLayoutEffect, type ReactNode } from "react";
import { Skeleton } from "./ui/skeleton";
import { DialogShellContext } from "./DialogShellContext";

/** Paint the same form layout without exposing incomplete controls to input or accessibility. */
export function DialogSkeleton({
  children,
  loading = true,
}: {
  children: ReactNode;
  loading?: boolean;
}) {
  const shell = useContext(DialogShellContext);
  const onLoading = shell?.loading;
  useLayoutEffect(() => {
    if (loading) onLoading?.();
  }, [onLoading, loading]);
  return (
    <Skeleton
      className={[
        "dialog-skeleton contents bg-transparent rounded-none",
        "text-transparent! caret-transparent! text-shadow-none! [&_*]:text-transparent! [&_*]:caret-transparent! [&_*]:text-shadow-none! [&_*::placeholder]:text-transparent!",
        String.raw`[&_:is(input,textarea,button,.segmented-control,[data-slot=metadata-reference],[data-slot=cover-editor-preview],.book-cover)]:bg-surface-raised!`,
        String.raw`[&_:is(input,textarea,button,.segmented-control,[data-slot=metadata-reference],[data-slot=cover-editor-preview],.book-cover)]:border-transparent!`,
        String.raw`[&_:is(input,textarea,button,.segmented-control,[data-slot=metadata-reference],[data-slot=cover-editor-preview],.book-cover)]:shadow-none!`,
        String.raw`[&_:is(label>span,h3,.app-select\_\_label,[role=group]>[data-slot=field-label],[data-slot=cover-editor-book]_:is(strong,small))]:skeleton-label`,
      ].join(" ")}
      aria-hidden="true"
      inert
    >
      {children}
    </Skeleton>
  );
}
