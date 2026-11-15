import { PageMetadata } from "@docusaurus/theme-common";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { Brand } from "@site/src/components/shared/Brand";

export default function NotFoundContent() {
  const home = useBaseUrl("/");
  const docs = useBaseUrl("/docs/");
  const linkClass =
    "text-accent underline underline-offset-4 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring";
  return (
    <>
      <PageMetadata title="Page not found" description="Find your way back to Archeion." />
      <div className="min-h-screen bg-surface font-sans text-content">
        <header className="mx-auto max-w-site px-gutter py-6">
          <a href={home} target="_self" className={linkClass} aria-label="Archeion home">
            <Brand />
          </a>
        </header>
        <main className="mx-auto max-w-article px-gutter py-section">
          <h1 className="font-editorial text-article-title text-content-strong">Page not found</h1>
          <p className="text-body text-content-muted">This address does not have a page.</p>
          <nav aria-label="Find a page" className="flex flex-wrap gap-6">
            <a className={linkClass} href={home}>
              Home
            </a>
            <a className={linkClass} href={docs}>
              Documentation
            </a>
          </nav>
        </main>
      </div>
    </>
  );
}
