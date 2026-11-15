import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Archive, BookOpen, Bookmark, FileText, Folder, Search } from "lucide-react";
import { DownloadActions } from "./DownloadAction";
import { useLandingMotion } from "./useLandingMotion";

const decorations = [
  {
    Icon: BookOpen,
    depth: 1.1,
    position: "top-[20%] left-[clamp(32px,8vw,112px)]",
    duration: 7000,
    rise: -9,
    rotation: [-7, -3],
  },
  {
    Icon: Bookmark,
    depth: -0.85,
    position: "top-[17%] right-[clamp(36px,9vw,128px)]",
    duration: 8000,
    rise: 8,
    rotation: [5, 1],
  },
  {
    Icon: FileText,
    depth: 0.7,
    position: "bottom-[14%] left-[clamp(28px,6vw,88px)]",
    duration: 7500,
    rise: -7,
    rotation: [4, 8],
  },
  {
    Icon: Folder,
    depth: -1.05,
    position: "bottom-[13%] right-[clamp(32px,7vw,100px)]",
    duration: 8500,
    rise: 7,
    rotation: [-4, 1],
  },
  {
    Icon: Archive,
    depth: 0.9,
    position: "top-[57%] left-[clamp(90px,25vw,360px)]",
    duration: 8200,
    rise: 7,
    rotation: [-4, 1],
  },
  {
    Icon: Search,
    depth: -0.75,
    position: "top-[57%] right-[clamp(90px,25vw,360px)]",
    duration: 7800,
    rise: -7,
    rotation: [4, 8],
  },
];

export function HeroSection() {
  const [hovered, setHovered] = useState(false);
  const copy = useRef<HTMLDivElement>(null);
  const effects = useRef<HTMLDivElement>(null);
  const motion = useLandingMotion();
  const pointer = useLandingMotion(true);
  useEffect(() => {
    if (!motion) return;
    const animation = copy.current?.animate(
      [
        { opacity: 0.88, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 650, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    return () => animation?.cancel();
  }, [motion]);
  useEffect(() => {
    if (!pointer) return;
    const animations = decorations.flatMap(({ duration, rise, rotation }, index) => {
      const node = effects.current?.children[index];
      if (!node) return [];
      return [
        node.animate(
          [
            { transform: `translateY(0) rotate(${rotation[0]}deg)` },
            { transform: `translateY(${rise}px) rotate(${rotation[1]}deg)` },
            { transform: `translateY(0) rotate(${rotation[0]}deg)` },
          ],
          { duration, iterations: Infinity, easing: "ease-in-out" },
        ),
      ];
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [pointer]);
  const parallax = useRef<Animation[]>([]);
  const frame = useRef(0);
  const position = useRef({ x: 0, y: 0 });
  const resetParallax = () => {
    setHovered(false);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    parallax.current.forEach((animation) => animation.cancel());
  };
  useEffect(() => {
    window.addEventListener("blur", resetParallax);
    return () => {
      resetParallax();
      window.removeEventListener("blur", resetParallax);
    };
  }, [pointer]);
  return (
    <section
      id="top"
      tabIndex={-1}
      aria-labelledby="hero-title"
      className="relative isolate scroll-mt-17 landing-mobile:scroll-mt-16 overflow-hidden pt-19 pb-12 text-center landing-mobile:pt-15 landing-mobile:pb-8"
      onPointerMove={(event) => {
        if (!pointer || event.pointerType !== "mouse") return;
        setHovered(true);
        const bounds = event.currentTarget.getBoundingClientRect();
        position.current = {
          x: (((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1) * -18,
          y: (((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2 - 1) * -14,
        };
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          parallax.current.forEach((animation) => animation.cancel());
          parallax.current = decorations.flatMap(({ depth }, index) => {
            const node = effects.current?.children[index]?.querySelector("svg");
            if (!node) return [];
            const transform = `translate(${position.current.x * depth}px,${position.current.y * depth}px)`;
            return [
              node.animate([{ transform }, { transform }], { duration: 1, fill: "forwards" }),
            ];
          });
        });
      }}
      onPointerLeave={resetParallax}
    >
      <div
        ref={effects}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden overflow-hidden text-landing-decoration landing-effects:block"
      >
        {decorations.map(({ Icon, position }, index) => (
          <span
            key={index}
            className={cn(
              "absolute grid place-items-center transition-opacity",
              position,
              pointer && hovered ? "opacity-50" : "opacity-[.34]",
            )}
          >
            <Icon className="size-10" strokeWidth={1.5} />
          </span>
        ))}
      </div>
      <div
        ref={copy}
        className="relative mx-auto w-landing-content max-w-landing-copy landing-tablet:w-landing-tablet landing-mobile:w-landing-mobile landing-tiny:w-landing-narrow"
      >
        <h1
          id="hero-title"
          className="mx-auto mb-0 max-w-landing-title font-display text-landing-hero landing-mobile:max-w-landing-title-mobile landing-mobile:text-landing-hero-mobile text-balance font-normal tracking-display text-content-strong"
        >
          The EPUB library for Windows.
        </h1>
        <p className="mx-auto mt-4.5 mb-6 max-w-landing-lead text-lead landing-mobile:max-w-landing-lead-mobile landing-mobile:text-base landing-mobile:leading-[1.65] text-content-muted">
          Open an existing folder of EPUBs to browse, search, organize, and read your books.
        </p>
        <DownloadActions />
      </div>
    </section>
  );
}
