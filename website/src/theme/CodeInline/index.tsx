import type { Props } from "@theme/CodeInline";

export default function CodeInline(props: Props) {
  return (
    <code
      {...props}
      className="rounded-sm border border-solid border-border bg-surface-raised px-1.25 py-0.5 font-mono text-sm whitespace-break-spaces text-content-strong"
    />
  );
}
