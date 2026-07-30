import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { MAIN_CONTENT_ID } from "./SkipLink";

export function NotFoundPage() {
  return (
    <main className="status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
      <p className="status-page__code">404</p>
      <h1>Page not found</h1>
      <p>This page is not part of your archive.</p>
      <Link className="text-link" to="/">
        <ArrowLeft aria-hidden="true" size={18} />
        Return to library
      </Link>
    </main>
  );
}
