import { StatusPage } from "./StatusPage";
import { statusCodeClass, statusLinkClass } from "./statusStyles";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { MAIN_CONTENT_ID } from "./SkipLink";

export function NotFoundPage() {
  return (
    <StatusPage className="status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
      <p className={statusCodeClass} data-status-code>
        404
      </p>
      <h1>Page not found</h1>
      <p>This page is not part of your archive.</p>
      <Link className={`${statusLinkClass} mt-status-link-gap`} to="/">
        <ArrowLeft aria-hidden="true" size={18} />
        Return to library
      </Link>
    </StatusPage>
  );
}
