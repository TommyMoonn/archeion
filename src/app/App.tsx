import { RouterProvider } from "react-router-dom";

import { WindowFrame } from "../components/WindowFrame";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import { ArchiveManagerWindow } from "../features/archive/ArchiveManagerWindow";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";
import { resolveWindowMode } from "./windowMode";

export function App() {
  const windowMode = resolveWindowMode();

  if (windowMode === "archive-manager") {
    return <ArchiveManagerWindow />;
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
