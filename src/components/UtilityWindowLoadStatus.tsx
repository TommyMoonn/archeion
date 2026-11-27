import { Button } from "./Button";
import { Spinner } from "./ui/spinner";
import {
  useUtilityWindowLoadState,
  type UtilityWindowLoadState,
} from "./useUtilityWindowLoadState";

export function UtilityWindowLoadStatus({
  title,
  state,
}: {
  title: string;
  state: UtilityWindowLoadState;
}) {
  const failed = state === "error";
  return (
    <div
      className={`utility-load-status${failed ? "" : " grid size-full place-items-center text-muted"}`}
      data-utility-stage={failed ? "error" : "loading"}
    >
      {failed ? (
        <>
          <p role="alert">{title} could not be loaded. Reload this window to try again.</p>
          <Button onClick={() => location.reload()} variant="secondary">
            Reload window
          </Button>
        </>
      ) : (
        <Spinner aria-label={`Loading ${title}`} className="size-6 stroke-2" data-visible />
      )}
    </div>
  );
}

export function UtilityWindowLoading({ title }: { title: string }) {
  const state = useUtilityWindowLoadState();
  return <UtilityWindowLoadStatus state={state} title={title} />;
}
