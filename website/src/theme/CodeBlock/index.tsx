import type { Props } from "@theme/CodeBlock";

export default function CodeBlock({ children }: Props) {
  return (
    <pre className="my-6 min-w-0 overflow-x-auto rounded-button border border-solid border-border bg-surface-raised px-5 py-4.5 text-sm leading-7 text-content">
      <code className="border-0 bg-transparent p-0 font-mono text-inherit">{children}</code>
    </pre>
  );
}
