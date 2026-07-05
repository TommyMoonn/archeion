import { RouterProvider } from "react-router-dom";

import { WindowFrame } from "../components/WindowFrame";
import { VaultGate } from "../features/vault/VaultGate";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";

export function App() {
  return (
    <div className="window-app">
      <WindowFrame />
      <div className="window-app__content">
        <LibraryStorageProvider>
          <VaultGate>
            <RouterProvider router={router} />
          </VaultGate>
        </LibraryStorageProvider>
      </div>
    </div>
  );
}
