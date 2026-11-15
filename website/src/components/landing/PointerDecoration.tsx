import { useId } from "react";
import { cn } from "@/lib/utils";

export function PointerGlow({
  point,
  radius = 300,
  kind = "card",
}: {
  point: { x: number; y: number } | null;
  radius?: number;
  kind?: "card" | "download" | "page";
}) {
  const gradient = useId();
  if (!point) return null;
  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none inset-0 size-full overflow-hidden rounded-[inherit]",
        kind === "page" ? "fixed z-header mix-blend-screen" : "absolute",
      )}
    >
      <defs>
        <radialGradient id={gradient}>
          <stop
            stopColor="currentColor"
            className={kind === "download" ? "text-landing-highlight" : "text-accent"}
            stopOpacity={kind === "download" ? 0.2 : kind === "page" ? 0.1 : 0.11}
          />
          <stop
            offset={kind === "page" ? "78%" : kind === "download" ? "72%" : "74%"}
            stopOpacity={0}
            stopColor="currentColor"
            className="text-accent"
          />
        </radialGradient>
      </defs>
      <circle cx={point.x} cy={point.y} r={radius} fill={`url(#${gradient})`} />
    </svg>
  );
}
