import { Button } from "./Button";
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
    <div className="utility-load-status" data-utility-stage={failed ? "error" : "loading"}>
      <p role={failed ? "alert" : "status"}>
        {failed
          ? `${title} could not be loaded. Reload this window to try again.`
          : `Opening ${title}`}
      </p>
      {failed && (
        <Button onClick={() => location.reload()} variant="secondary">
          Reload window
        </Button>
      )}
    </div>
  );
}

export function UtilityWindowLoading({ title }: { title: string }) {
  const state = useUtilityWindowLoadState();
  return <UtilityWindowLoadStatus state={state} title={title} />;
}
