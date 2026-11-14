import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocsBreadcrumbs } from "./DocsBreadcrumbs";

export function DocsArticleHeader({
  title,
  description,
  articleType,
}: {
  title: string;
  description: string;
  articleType: string;
}) {
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3.5">
        <DocsBreadcrumbs />
        <Button
          disabled
          variant="ghost"
          size="sm"
          title="Article copying follows in B2.6"
          className="shrink-0 text-caption font-normal disabled:bg-transparent disabled:text-content-subtle"
        >
          <Copy aria-hidden="true" className="size-3.25" />
          Copy page
        </Button>
      </div>
      <header className="mb-6.5">
        <div className="mb-2.75 flex items-center gap-1.5 text-docs-label font-semibold tracking-docs-label text-accent uppercase">
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
