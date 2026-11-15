import { useEffect, useRef } from "react";
import { Archive, BookOpen, Bookmark, FileText, Folder, Search } from "lucide-react";
import { DownloadActions } from "./DownloadAction";
import { useLandingMotion } from "./useLandingMotion";

const decorations = [
  { Icon: BookOpen, depth: 1.1 },
  { Icon: Bookmark, depth: -0.85 },
  { Icon: FileText, depth: 0.7 },
  { Icon: Folder, depth: -1.05 },
  { Icon: Archive, depth: 0.9 },
  { Icon: Search, depth: -0.75 },
];

export function HeroSection() {
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
      { duration: 650, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [motion]);
  useEffect(() => {
    if (!pointer) return;
    const animations = Array.from(effects.current?.children ?? []).map((node, index) =>
      node.animate(
        [
          { transform: "translateY(0)" },
          { transform: "translateY(-8px)" },
          { transform: "translateY(0)" },
        ],
        { duration: 7000 + index * 250, iterations: Infinity, easing: "ease-in-out" },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [pointer]);
  const parallax = useRef<Animation[]>([]);
  const frame = useRef(0);
  const position = useRef({ x: 0, y: 0 });
  const resetParallax = () => {
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
      className="relative px-8 pt-20 pb-12 text-center landing-mobile:px-5 landing-mobile:pt-15 landing-mobile:pb-8"
      onPointerMove={(event) => {
        if (!pointer || event.pointerType !== "mouse") return;
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
        className="pointer-events-none absolute inset-0 hidden items-center justify-around text-content-subtle landing-effects:flex motion-reduce:invisible"
      >
        {decorations.map(({ Icon }, index) => (
          <span key={index} className="opacity-30">
            <Icon className="size-10" strokeWidth={1.5} />
          </span>
        ))}
      </div>
      <div ref={copy} className="relative mx-auto max-w-site">
        <h1
          id="hero-title"
          className="mx-auto mb-0 max-w-hero-copy font-display text-hero font-normal tracking-display text-content-strong"
        >
          The EPUB library for Windows.
        </h1>
        <p className="mx-auto mt-5 mb-6 max-w-prose text-lead text-content-muted">
          Open an existing folder of EPUBs to browse, search, organize, and read your books.
        </p>
        <DownloadActions />
      </div>
    </section>
  );
}
