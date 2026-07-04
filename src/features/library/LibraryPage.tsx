import { BookOpenText, WarningCircle, X } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { bookRepository } from "../../db/bookRepository";
import { ImportDropzone } from "../import/ImportDropzone";
import {
  importEpubFiles,
  type ImportResult,
} from "../import/importEpub";
import { ImportedBookGrid } from "./ImportedBookGrid";
import { LibrarySidebar } from "./LibrarySidebar";
import { LibraryToolbar } from "./LibraryToolbar";

type FailedImport = Extract<ImportResult, { status: "failed" }>;

export function LibraryPage() {
  const books = useLiveQuery(() => bookRepository.list(), [], []);
  const importLock = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [failedImports, setFailedImports] = useState<FailedImport[]>([]);

  async function handleFiles(files: File[]) {
    if (importLock.current) {
      return;
    }

    importLock.current = true;
    setIsImporting(true);
    setFailedImports([]);

    try {
      const results = await importEpubFiles(files);

      setFailedImports(
        results.filter(
          (result): result is FailedImport => result.status === "failed",
        ),
      );
    } finally {
      importLock.current = false;
      setIsImporting(false);
    }
  }

  const bookCount = books?.length ?? 0;

  return (
    <PageShell sidebar={<LibrarySidebar bookCount={bookCount} />}>
      <ImportDropzone disabled={isImporting} onFiles={handleFiles}>
        <LibraryToolbar
          isImporting={isImporting}
          onFiles={handleFiles}
        />

        {failedImports.length > 0 ? (
          <div className="import-notice" role="alert">
            <WarningCircle aria-hidden="true" size={19} weight="regular" />
            <div>
              <p>
                {failedImports.length === 1
                  ? "One file could not be imported."
                  : `${failedImports.length} files could not be imported.`}
              </p>
              <ul>
                {failedImports.map((result, index) => (
                  <li key={`${result.fileName}-${index}`}>
                    <span>{result.fileName}</span>
                    {result.message}
                  </li>
                ))}
              </ul>
            </div>
            <IconButton
              label="Dismiss import errors"
              onClick={() => setFailedImports([])}
            >
              <X aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          </div>
        ) : null}

        <div className="library-content">
          {books === undefined || (isImporting && books.length === 0) ? (
            <div className="library-loading" role="status">
              <span className="library-loading__cover" />
              <span>
                {isImporting ? "Importing EPUB files" : "Loading library"}
              </span>
            </div>
          ) : books.length === 0 ? (
            <EmptyState
              description="Import an EPUB or drop files here to start your collection."
              icon={<BookOpenText size={42} weight="thin" />}
              title="No books yet"
            />
          ) : (
            <ImportedBookGrid books={books} />
          )}
        </div>
      </ImportDropzone>
    </PageShell>
  );
}
