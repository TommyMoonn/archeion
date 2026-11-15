export function PointerGlow({
  point,
  radius = 150,
}: {
  point: { x: number; y: number } | null;
  radius?: number;
}) {
  if (!point) return null;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden rounded-[inherit] opacity-5"
    >
      <circle cx={point.x} cy={point.y} r={radius} className="fill-accent" />
    </svg>
  );
}
