import type { Props } from "@theme/DocsRoot";
import LayoutProvider from "@theme/Layout/Provider";
import renderRoutes from "@docusaurus/renderRoutes";
import ErrorBoundary from "@docusaurus/ErrorBoundary";
import ErrorPageContent from "@theme/ErrorPageContent";

export default function DocsRoot({ route }: Props) {
  if (!route.routes) throw new Error("Documentation routes are missing");
  return (
    <LayoutProvider>
      <div className="min-h-screen bg-surface font-sans text-content">
        <ErrorBoundary fallback={(params) => <ErrorPageContent {...params} />}>
          {renderRoutes(route.routes)}
        </ErrorBoundary>
      </div>
    </LayoutProvider>
  );
}
