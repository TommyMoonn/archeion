import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocsBreadcrumbs } from "./DocsBreadcrumbs";
import { useDocsClipboard } from "./useDocsClipboard";
import useIsBrowser from "@docusaurus/useIsBrowser";

export function DocsArticleHeader({
  title,
  description,
  articleType,
}: {
  title: string;
  description: string;
  articleType: string;
}) {
  const { copyPage } = useDocsClipboard();
  const isBrowser = useIsBrowser();
  return (
    <>
      <div
        data-copy-exclude
        className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-3.5 docs-narrow:mb-5 docs-narrow:min-h-7.5 pointer-coarse:min-h-11 docs-narrow:pointer-coarse:min-h-11"
      >
        <DocsBreadcrumbs />
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => copyPage(event.currentTarget)}
          disabled={!isBrowser}
          className={`h-auto min-h-9 max-w-full shrink-0 bg-control text-caption font-normal whitespace-normal docs-narrow:min-h-7.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11 docs-narrow:pointer-coarse:min-h-11 ${isBrowser ? "" : "invisible"}`}
        >
          <Copy aria-hidden="true" className="size-3.25" />
          Copy page
        </Button>
      </div>
      <header className="mb-6.5">
        <div
          data-copy-exclude
          className="mb-2.75 flex items-center gap-1.5 text-docs-label font-bold tracking-docs-label text-accent uppercase"
        >
          {articleType !== "Overview" && (
            <span aria-hidden="true" className="size-1.25 rounded-full bg-accent" />
          )}
          {articleType}
        </div>
        <h1 className="mt-0 mb-4 text-article-title font-normal tracking-display text-balance text-content-strong font-editorial docs-narrow:text-docs-title-mobile">
          {title}
        </h1>
        <p className="m-0 text-docs-lead text-content-muted">{description}</p>
      </header>
    </>
  );
}
