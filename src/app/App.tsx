import { RouterProvider } from "react-router-dom";

import { WindowFrame } from "../components/WindowFrame";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";

export function App() {
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
