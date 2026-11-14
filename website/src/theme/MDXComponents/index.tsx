import type { ComponentProps } from "react";
import OriginalComponents from "@theme-original/MDXComponents";
import type { MDXComponentsObject } from "@theme/MDXComponents";
import Link from "@docusaurus/Link";

const MDXComponents: MDXComponentsObject = {
  ...OriginalComponents,
  h2: (props: ComponentProps<"h2">) => (
    <h2
      {...props}
      className="mt-12 mb-4.25 scroll-mt-24 font-editorial text-docs-heading font-normal tracking-display text-balance text-content-strong docs-narrow:text-docs-heading-mobile"
    />
  ),
  h3: (props: ComponentProps<"h3">) => (
    <h3
      {...props}
      className="mt-7.5 mb-3 scroll-mt-24 text-docs-subheading font-semibold tracking-tight text-content-strong"
    />
  ),
  p: (props: ComponentProps<"p">) => <p {...props} className="mt-0 mb-4.75" />,
  a: ({ href, ...props }: ComponentProps<"a">) => (
    <Link
      {...props}
      href={href}
      className="text-accent underline decoration-accent underline-offset-3 hover:text-content-strong"
    />
  ),
  strong: (props: ComponentProps<"strong">) => (
    <strong {...props} className="font-semibold text-content-strong" />
  ),
  ul: (props: ComponentProps<"ul">) => <ul {...props} className="mt-0 mb-4.5 list-disc ps-6" />,
  ol: (props: ComponentProps<"ol">) => <ol {...props} className="mt-0 mb-4.5 list-decimal ps-6" />,
  li: (props: ComponentProps<"li">) => (
    <li {...props} className="my-2.25 ps-1 marker:text-content-subtle" />
  ),
  blockquote: (props: ComponentProps<"blockquote">) => (
    <blockquote
      {...props}
      className="mx-0 my-5.5 border-0 border-s-2 border-solid border-border-strong py-0.5 ps-4.5 text-content-muted"
    />
  ),
  hr: () => <hr className="my-8 border-0 border-t border-solid border-border" />,
  table: (props: ComponentProps<"table">) => (
    <div className="my-6 overflow-x-auto rounded-button border border-solid border-border">
      <table {...props} className="m-0 table w-full border-collapse text-sm wrap-normal" />
    </div>
  ),
  th: (props: ComponentProps<"th">) => (
    <th
      {...props}
      className="border-0 border-b border-solid border-border bg-surface-raised px-3.25 py-2.75 text-start font-semibold text-content-strong"
    />
  ),
  td: (props: ComponentProps<"td">) => (
    <td
      {...props}
      className="border-0 border-b border-solid border-border px-3.25 py-2.75 align-top"
    />
  ),
  tr: (props: ComponentProps<"tr">) => (
    <tr {...props} className="border-0 bg-transparent last:[&_td]:border-b-0" />
  ),
};

export default MDXComponents;
