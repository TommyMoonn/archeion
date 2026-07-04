import { BookOpenText } from "@phosphor-icons/react";

import { EmptyState } from "../../components/EmptyState";
import { PageShell } from "../../components/PageShell";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryToolbar } from "./LibraryToolbar";

export function LibraryPage() {
  return (
    <PageShell sidebar={<LibrarySidebar />}>
      <LibraryToolbar />
      <div className="library-content">
        <EmptyState
          description="Import an EPUB to start building your local collection."
          icon={<BookOpenText size={42} weight="thin" />}
          title="No books yet"
        />
      </div>
    </PageShell>
  );
}
