import { ArrowLeft } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="status-page">
      <p className="status-page__code">404</p>
      <h1>Page not found</h1>
      <p>This page is not part of your archive.</p>
      <Link className="text-link" to="/">
        <ArrowLeft aria-hidden="true" size={18} weight="regular" />
        Return to library
      </Link>
    </main>
  );
}
