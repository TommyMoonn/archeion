import { LoadingStatus } from "../components/LoadingStatus";
import { StatusPage } from "../components/StatusPage";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { MAIN_CONTENT_ID, SkipLink } from "../components/SkipLink";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { TooltipProvider } from "../components/Tooltip";
import { QuickActionsProvider } from "../features/quick-actions/QuickActionsProvider";
import { ReaderArchiveSessionContext } from "../features/archive/readerArchiveSession";
import { findStandaloneReaderManagedBook } from "../features/reader/externalReaderSource";
import { LibraryStorageContext } from "../storage/useLibraryStorage";
import type { LibraryStorage } from "../storage/LibraryStorage";
import type { Book } from "../types/book";
import { revealColdStartReaderWindow, type ExternalReaderRequest } from "./coldStartEpubClient";

const StandaloneReaderPage = lazy(() =>
  import("../features/reader/ReaderPage").then(({ ReaderPage }) => ({ default: ReaderPage })),
);

type ManagedReader = Readonly<{
  archiveId: string;
  rootPath: string;
  book: Book;
  storage: LibraryStorage;
}>;

type ReaderResolution =
  { status: "checking" } | { status: "temporary" } | { status: "managed"; session: ManagedReader };

// This window never initializes ArchiveStore or the main Library. Each managed
// Reader gets an independent storage owner pinned to the matched archive.
export function StandaloneReaderStartup({ request }: { request: ExternalReaderRequest | null }) {
  const [resolution, setResolution] = useState<ReaderResolution>({ status: "checking" });
  useEffect(() => {
    if (!request) return;
    let active = true;
    const resolve = async () => {
      try {
        const match = await findStandaloneReaderManagedBook(request.token);
        if (!match) {
          if (active) setResolution({ status: "temporary" });
          return;
        }
        const { TauriArchiveLibraryStorage } =
          await import("../storage/TauriArchiveLibraryStorage");
        if (!active) return;
        const storage = new TauriArchiveLibraryStorage();
        const book = await storage.openStandaloneBook(
          match.archiveRootPath,
          match.bookId,
          match.relativePath,
        );
        if (active) {
          setResolution(
            book
              ? {
                  status: "managed",
                  session: {
                    archiveId: match.archiveId,
                    rootPath: match.archiveRootPath,
                    book,
                    storage,
                  },
                }
              : { status: "temporary" },
          );
        }
      } catch {
        // A missing, changed, or inaccessible archive never prevents reading
        // the selected file as a temporary session.
        if (active) setResolution({ status: "temporary" });
      }
    };
    void resolve();
    return () => {
      active = false;
    };
  }, [request]);

  useEffect(() => {
    void revealColdStartReaderWindow().catch((error: unknown) => {
      console.error("Unable to reveal standalone Reader window", error);
    });
  }, []);

  const router = useMemo(
    () =>
      createMemoryRouter([
        {
          path: "/",
          HydrateFallback: () => null,
          loader: () => null,
          element:
            request && resolution.status !== "checking" ? (
              <Suspense
                fallback={
                  <StatusPage
                    className="reader-status-page h-full min-h-0"
                    id={MAIN_CONTENT_ID}
                    aria-busy="true"
                    tabIndex={-1}
                  >
                    <LoadingStatus message="Opening EPUB…" />
                  </StatusPage>
                }
              >
                {resolution.status === "managed" ? (
                  <ReaderArchiveSessionContext
                    value={{
                      archiveId: resolution.session.archiveId,
                      rootPath: resolution.session.rootPath,
                    }}
                  >
                    <LibraryStorageContext value={resolution.session.storage}>
                      <StandaloneReaderPage
                        externalSession={request}
                        managedBook={resolution.session.book}
                      />
                    </LibraryStorageContext>
                  </ReaderArchiveSessionContext>
                ) : (
                  <StandaloneReaderPage externalSession={request} />
                )}
              </Suspense>
            ) : null,
        },
      ]),
    [request, resolution],
  );

  return (
    <TooltipProvider>
      <div className="window-app">
        <SkipLink targetId={MAIN_CONTENT_ID} />
        <WindowTitlebar canMaximize />
        <div className="window-app__content">
          {request ? (
            resolution.status === "checking" ? (
              <StatusPage
                className="reader-status-page h-full min-h-0"
                id={MAIN_CONTENT_ID}
                aria-busy="true"
                tabIndex={-1}
              >
                <LoadingStatus message="Opening EPUB…" />
              </StatusPage>
            ) : (
              <QuickActionsProvider>
                <RouterProvider router={router} />
              </QuickActionsProvider>
            )
          ) : (
            <StatusPage className="reader-status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
              <h1>Unable to read the launch request</h1>
              <p role="alert">Close Archeion and try opening the EPUB again.</p>
            </StatusPage>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
