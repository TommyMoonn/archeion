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
    path: "/archives",
    lazy: async () => {
      const { ArchiveManagerPage } = await import(
        "../features/archive/ArchiveManagerPage"
      );

      return { Component: ArchiveManagerPage };
    },
  },
  {
    path: "/reader/:bookId",
    lazy: async () => {
      const { ReaderPage } = await import("../features/reader/ReaderPage");

      return { Component: ReaderPage };
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
