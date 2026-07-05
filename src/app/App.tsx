import { RouterProvider } from "react-router-dom";

import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { router } from "./router";

export function App() {
  return (
    <LibraryStorageProvider>
      <RouterProvider router={router} />
    </LibraryStorageProvider>
  );
}
