import { RouterProvider } from "react-router-dom";

import { VaultGate } from "../features/vault/VaultGate";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";

export function App() {
  return (
    <LibraryStorageProvider>
      <VaultGate>
        <RouterProvider router={router} />
      </VaultGate>
    </LibraryStorageProvider>
  );
}
