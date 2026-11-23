import { lazy, Suspense, useEffect, useMemo } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { MAIN_CONTENT_ID, SkipLink } from "../components/SkipLink";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { TooltipProvider } from "../components/Tooltip";
import { QuickActionsProvider } from "../features/quick-actions/QuickActionsProvider";
import { revealColdStartReaderWindow, type ExternalReaderRequest } from "./coldStartEpubClient";

const StandaloneReaderPage = lazy(() =>
  import("../features/reader/ReaderPage").then(({ ReaderPage }) => ({ default: ReaderPage })),
);

export function StandaloneReaderStartup({ request }: { request: ExternalReaderRequest | null }) {
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
          element: request ? (
            <Suspense
              fallback={
                <main
                  className="reader-status-page"
                  id={MAIN_CONTENT_ID}
                  role="status"
                  tabIndex={-1}
                >
                  Opening EPUB…
                </main>
              }
            >
              <StandaloneReaderPage externalSession={request} />
            </Suspense>
          ) : null,
        },
      ]),
    [request],
  );

  return (
    <TooltipProvider>
      <div className="window-app">
        <SkipLink targetId={MAIN_CONTENT_ID} />
        <WindowTitlebar canMaximize />
        <div className="window-app__content">
          {request ? (
            <QuickActionsProvider>
              <RouterProvider router={router} />
            </QuickActionsProvider>
          ) : (
            <main className="reader-status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
              <h1>Unable to read the launch request</h1>
              <p role="alert">Close Archeion and try opening the EPUB again.</p>
            </main>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
