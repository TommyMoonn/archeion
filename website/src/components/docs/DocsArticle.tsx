import type { ReactNode } from "react";
import { useDoc } from "@docusaurus/plugin-content-docs/client";
import MDXContent from "@theme/MDXContent";
import { DocsClipboard } from "./DocsClipboard";
import { DocsArticleHeader } from "./DocsArticleHeader";
import { DocsArticleFooter } from "./DocsArticleFooter";
import { DocsArticleNavigation } from "./DocsArticleNavigation";
import { DocsTableOfContents } from "./DocsTableOfContents";

export function DocsArticle({ children }: { children: ReactNode }) {
  const { metadata } = useDoc();
  const articleType =
    typeof metadata.frontMatter.doc_type === "string" ? metadata.frontMatter.doc_type : "Guide";
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--spacing-docs-rail)] items-start gap-7 docs-wide:block">
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex min-h-[calc(100vh-4.25rem)] w-full max-w-docs-article min-w-0 box-border flex-col pt-10.5 pb-9 focus:outline-none docs-navigation:min-h-0 docs-navigation:pt-7.5 docs-narrow:pt-6"
      >
        <DocsClipboard key={metadata.permalink}>
          <article className="min-w-0">
            <DocsArticleHeader
              title={metadata.title}
              description={metadata.description}
              articleType={articleType}
            />
            <div className="text-docs-body wrap-anywhere">
              <MDXContent>{children}</MDXContent>
            </div>
          </article>
        </DocsClipboard>
        <DocsArticleFooter editUrl={metadata.editUrl} />
        <DocsArticleNavigation previous={metadata.previous} next={metadata.next} />
      </main>
      <DocsTableOfContents />
    </div>
  );
}
