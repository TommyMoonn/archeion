import { ArrowUpRight, Grid2X2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { landingLinks } from "./content";
import { PointerGlow } from "./PointerDecoration";
import { usePointerDecoration } from "./usePointerDecoration";

export function DownloadAction() {
  const { target, point, ...pointer } = usePointerDecoration("download");
  return (
    <div {...pointer} className="w-56 max-w-full">
      <div ref={target} className="relative">
        <Button
          asChild
          size="lg"
          className="relative min-h-12 w-full overflow-hidden motion-safe:active:scale-[.985]"
        >
          <a href={landingLinks.installer}>
            <Grid2X2 aria-hidden="true" />
            <span>Download for Windows</span>
            <PointerGlow point={point} radius={85} />
          </a>
        </Button>
      </div>
    </div>
  );
}

export function DownloadActions({ closing = false }: { closing?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <DownloadAction />
      <a
        href={closing ? landingLinks.releases : landingLinks.source}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex min-h-10 items-center justify-center gap-2 text-sm font-semibold text-content-muted hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {closing ? "View all releases" : "View on GitHub"}
        <ArrowUpRight
          aria-hidden="true"
          className="size-3 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
        />
      </a>
    </div>
  );
}
