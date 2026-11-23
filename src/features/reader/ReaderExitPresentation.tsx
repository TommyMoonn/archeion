import { useLayoutEffect, useRef } from "react";

import { Button } from "../../components/Button";
import type { ReaderExitFailure } from "./useReaderControlledTransitions";

export function ReaderExitPresentation({
  temporary = false,
  failure,
  toolbarExpanded,
  onReturn,
}: {
  temporary?: boolean;
  failure: ReaderExitFailure | null;
  toolbarExpanded: boolean;
  onReturn: () => void;
}) {
  const recoveryRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (failure) recoveryRef.current?.focus({ preventScroll: true });
  }, [failure]);

  return (
    <div
      className="reader-exit"
      data-exit-pending={!failure || undefined}
      data-exit-failure={failure ?? undefined}
    >
      <div className="reader-exit__clearance" aria-hidden="true" hidden={!toolbarExpanded} />
      <section className="reader-content-stage reader-exit__stage">
        <p role={failure ? "alert" : "status"}>
          {temporary
            ? "Closing Reader…"
            : failure === "timeout"
              ? "Returning to the Library took too long. Try again."
              : failure === "rejected"
                ? "The destination could not be opened. Return to the Library to continue."
                : "Returning to Library…"}
        </p>
        {failure ? (
          <Button ref={recoveryRef} onClick={onReturn} variant="secondary">
            {temporary ? "Close Reader" : "Return to Library"}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
