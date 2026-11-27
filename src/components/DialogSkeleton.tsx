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
        String.raw`[&_:is(input,textarea,button,.segmented-control,.metadata-writeback\_\_reference-value,.cover-writeback\_\_preview,.book-cover)]:bg-surface-raised!`,
        String.raw`[&_:is(input,textarea,button,.segmented-control,.metadata-writeback\_\_reference-value,.cover-writeback\_\_preview,.book-cover)]:border-transparent!`,
        String.raw`[&_:is(input,textarea,button,.segmented-control,.metadata-writeback\_\_reference-value,.cover-writeback\_\_preview,.book-cover)]:shadow-none!`,
        String.raw`[&_:is(label>span,h3,.app-select\_\_label,[role=group]>[data-slot=field-label],.cover-writeback\_\_framing>span,.cover-writeback\_\_book_strong,.cover-writeback\_\_book_small)]:skeleton-label`,
      ].join(" ")}
      aria-hidden="true"
      inert
    >
      {children}
    </Skeleton>
  );
}
