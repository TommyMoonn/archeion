import { lazy, Suspense } from "react";
import { RouterProvider } from "react-router-dom";

import { WindowFrame } from "../components/WindowFrame";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";
import { resolveWindowMode } from "./windowMode";

const ArchiveManagerWindow = lazy(() =>
  import("../features/archive/ArchiveManagerWindow").then((module) => ({
    default: module.ArchiveManagerWindow,
  })),
);

export function App() {
  const windowMode = resolveWindowMode();

  if (windowMode === "archive-manager") {
    return (
      <div className="window-app">
        <WindowFrame frameStyleOverride="hidden" />
        <div className="window-app__content">
          <Suspense fallback={null}>
            <ArchiveManagerWindow />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="window-app">
      <WindowFrame />
      <div className="window-app__content">
        <LibraryStorageProvider>
          <ArchiveGate>
            <RouterProvider router={router} />
          </ArchiveGate>
        </LibraryStorageProvider>
      </div>
    </div>
  );
}
