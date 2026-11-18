import { ArrowUpRight } from "lucide-react";
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
          className="relative min-h-12 w-full gap-2.5 overflow-hidden text-landing-button-foreground shadow-landing-button landing-pointer:hover:-translate-y-0.5 landing-pointer:hover:shadow-landing-button-hover motion-safe:active:translate-y-0 motion-safe:active:scale-[.985]"
        >
          <a href={landingLinks.installer}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-current">
              <path d="M2.25 5.05 10.45 3.9v7.25h-8.2V5.05Zm9.3-1.32 10.2-1.45v8.87h-10.2V3.73ZM2.25 12.45h8.2v7.25l-8.2-1.15v-6.1Zm9.3 0h10.2v8.87l-10.2-1.45v-7.42Z" />
            </svg>
            <span>Download for Windows</span>
            <PointerGlow point={point} radius={170} kind="download" />
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
        href={closing ? landingLinks.releases : landingLinks.installation}
        target={closing ? "_blank" : undefined}
        rel={closing ? "noopener noreferrer" : undefined}
        className="group inline-flex min-h-11 w-56 max-w-full items-center justify-center gap-2 text-sm font-semibold text-content-subtle motion-safe:transition-colors motion-safe:duration-300 hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        {closing ? "View all releases" : "View installation guide"}
        <ArrowUpRight
          aria-hidden="true"
          className="size-3 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
        />
      </a>
    </div>
  );
}
