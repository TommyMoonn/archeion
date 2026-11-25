import { cn } from "@/utils/cn";
import { Spinner } from "./ui/spinner";

export function LoadingStatus({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn("flex flex-col items-center gap-3 text-center text-body text-muted", className)}
      role="status"
    >
      <Spinner
        aria-hidden="true"
        role="presentation"
        aria-label={undefined}
        className="size-6 stroke-2"
        data-visible
      />
      <span>{message}</span>
    </div>
  );
}
