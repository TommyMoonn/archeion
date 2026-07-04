import { createBrowserRouter } from "react-router-dom";

import { NotFoundPage } from "../components/NotFoundPage";
import { bookRepository } from "../db/bookRepository";
import { LibraryPage } from "../features/library/LibraryPage";
import { ReaderPage } from "../features/reader/ReaderPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LibraryPage />,
  },
  {
    path: "/reader/:bookId",
    element: <ReaderPage />,
    loader: async ({ params }) => {
      if (!params.bookId) {
        return undefined;
      }

      try {
        return await bookRepository.get(params.bookId);
      } catch {
        return undefined;
      }
    },
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
