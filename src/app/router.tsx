import { createBrowserRouter } from "react-router-dom";

import { NotFoundPage } from "../components/NotFoundPage";
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
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
