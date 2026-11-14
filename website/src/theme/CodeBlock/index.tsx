import type { Props } from "@theme/CodeBlock";
import { useRef } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocsClipboard } from "@/components/docs/useDocsClipboard";

export default function CodeBlock({ children }: Props) {
  const code = useRef<HTMLElement>(null);
  const copy = useDocsClipboard();
  return (
    <div className="group relative my-6 min-w-0">
      <pre
        tabIndex={0}
        aria-label="Code example"
        className="m-0 min-w-0 overflow-x-auto rounded-button border border-solid border-border bg-surface-raised px-5 py-4.5 text-sm leading-7 text-content focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <code ref={code} className="border-0 bg-transparent p-0 font-mono text-inherit">
          {children}
        </code>
      </pre>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Copy code"
        title="Copy code"
        className="absolute end-2 top-2 bg-surface-raised opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:opacity-100"
        onClick={(event) => {
          if (code.current) void copy(code.current.textContent ?? "", event.currentTarget);
        }}
      >
        <Copy aria-hidden="true" />
      </Button>
    </div>
  );
}
