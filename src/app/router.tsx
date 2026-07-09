import { createBrowserRouter } from "react-router-dom";

import { getLibraryStorage } from "../storage/defaultLibraryStorage";

export const router = createBrowserRouter([
  {
    path: "/",
    lazy: async () => {
      const { LibraryPage } = await import("../features/library/LibraryPage");

      return { Component: LibraryPage };
    },
  },
  {
    path: "/reader/:bookId",
    lazy: async () => {
      const { ReaderRoute } = await import("../features/reader/ReaderPage");

      return { Component: ReaderRoute };
    },
    loader: async ({ params }) => {
      if (!params.bookId) {
        return undefined;
      }

      try {
        const storage = await getLibraryStorage();

        return await storage.getBook(params.bookId);
      } catch {
        return undefined;
      }
    },
  },
  {
    path: "*",
    lazy: async () => {
      const { NotFoundPage } = await import("../components/NotFoundPage");

      return { Component: NotFoundPage };
    },
  },
]);
