import { useContext, useLayoutEffect, type ReactNode } from "react";
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
    <div className="dialog-skeleton" aria-hidden="true" inert>
      {children}
    </div>
  );
}
