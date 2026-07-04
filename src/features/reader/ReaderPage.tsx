import { ArrowLeft, BookOpenText } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

export function ReaderPage() {
  return (
    <main className="reader-page">
      <header className="reader-toolbar">
        <Link aria-label="Return to library" className="icon-button" to="/">
          <ArrowLeft aria-hidden="true" size={20} weight="regular" />
        </Link>
        <p>Reader</p>
        <span className="reader-toolbar__spacer" />
      </header>

      <section className="reader-placeholder">
        <BookOpenText aria-hidden="true" size={36} weight="thin" />
        <h1>Reader coming soon</h1>
        <p>Return to your library to continue browsing.</p>
      </section>
    </main>
  );
}
