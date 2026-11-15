import type { ComponentProps } from "react";
import { Link as LinkIcon } from "lucide-react";
import useBrokenLinks from "@docusaurus/useBrokenLinks";

export function DocsHeading({
  level,
  children,
  ...props
}: ComponentProps<"h2"> & { level: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  useBrokenLinks().collectAnchor(props.id);
  return (
    <Heading
      {...props}
      tabIndex={-1}
      className={`group scroll-mt-24 text-content-strong focus-visible:outline-2 focus-visible:outline-focus-ring ${level === 2 ? "mt-12 mb-4.25 font-editorial text-docs-heading font-normal tracking-display text-balance docs-narrow:text-docs-heading-mobile" : "mt-7.5 mb-3 text-docs-subheading font-bold tracking-tight"}`}
    >
      {children}
      {props.id && (
        <a
          href={`#${props.id}`}
          aria-label={`Link to ${typeof children === "string" ? children : props.id.replaceAll("-", " ")}`}
          className="ms-2 inline-flex size-6 items-center justify-center align-middle text-content-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-focus-ring pointer-coarse:opacity-100"
        >
          <LinkIcon aria-hidden="true" className="size-3.5" />
        </a>
      )}
    </Heading>
  );
}
