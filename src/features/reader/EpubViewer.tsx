import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Book as EpubBook, Rendition, Location } from "epubjs";

import {
  normalizeReaderLocation,
  type ReaderLocation,
} from "./readerLocation";

export type EpubViewerHandle = {
  next: () => Promise<void>;
  previous: () => Promise<void>;
};

type EpubViewerProps = {
  fileBlob: Blob;
  initialCfi?: string;
  onError: (message: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (location: ReaderLocation) => void;
  onReady: () => void;
};

const readerTheme = {
  body: {
    color: "#d6d3d9 !important",
    background: "#171717 !important",
    "font-family":
      '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif !important',
    "font-size": "18px !important",
    "line-height": "1.65 !important",
    padding: "0 5% !important",
  },
  "p, li": {
    color: "#d6d3d9 !important",
  },
  "h1, h2, h3, h4, h5, h6": {
    color: "#ebe8ef !important",
    "font-weight": "500 !important",
    "line-height": "1.3 !important",
  },
  a: {
    color: "#8fc1e3 !important",
  },
  img: {
    "max-width": "100% !important",
    "object-fit": "contain !important",
  },
};

export const EpubViewer = forwardRef<EpubViewerHandle, EpubViewerProps>(
  function EpubViewer(
    {
      fileBlob,
      initialCfi,
      onError,
      onKeyDown,
      onLocationChange,
      onReady,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useImperativeHandle(
      ref,
      () => ({
        next: async () => {
          await renditionRef.current?.next();
        },
        previous: async () => {
          await renditionRef.current?.prev();
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      let epubBook: EpubBook | null = null;
      let rendition: Rendition | null = null;

      async function openBook() {
        try {
          const [{ default: ePub }, fileContents] = await Promise.all([
            import("epubjs"),
            fileBlob.arrayBuffer(),
          ]);

          if (cancelled || !containerRef.current) {
            return;
          }

          epubBook = ePub(fileContents);
          await epubBook.opened;

          if (cancelled || !containerRef.current) {
            epubBook.destroy();
            epubBook = null;
            return;
          }

          try {
            await epubBook.locations.generate(1600);
          } catch {
            // Reading can continue without a calculated percentage.
          }

          rendition = epubBook.renderTo(containerRef.current, {
            width: "100%",
            height: "100%",
            flow: "paginated",
            spread: "none",
            allowScriptedContent: false,
          });
          renditionRef.current = rendition;
          rendition.themes.default(readerTheme);
          rendition.on("keydown", onKeyDown);
          rendition.on("relocated", onRelocated);

          try {
            await rendition.display(initialCfi);
          } catch {
            await rendition.display();
          }

          if (!cancelled) {
            setIsLoading(false);
            onReady();
          }
        } catch {
          epubBook?.destroy();
          epubBook = null;

          if (!cancelled) {
            setIsLoading(false);
            onError("This EPUB could not be opened.");
          }
        }
      }

      function onRelocated(location: Location) {
        if (!cancelled) {
          onLocationChange(
            normalizeReaderLocation(
              location,
              epubBook?.packaging.spine.length ?? 0,
            ),
          );
        }
      }

      void openBook();

      return () => {
        cancelled = true;

        if (rendition) {
          rendition.off("keydown", onKeyDown);
          rendition.off("relocated", onRelocated);
        }

        renditionRef.current = null;
        epubBook?.destroy();
      };
    }, [
      fileBlob,
      initialCfi,
      onError,
      onKeyDown,
      onLocationChange,
      onReady,
    ]);

    return (
      <div className="epub-viewer">
        <div ref={containerRef} className="epub-viewer__stage" />
        {isLoading ? (
          <div className="reader-loading" role="status">
            <span className="reader-loading__line" />
            <span className="reader-loading__line reader-loading__line--short" />
            <span>Opening book</span>
          </div>
        ) : null}
      </div>
    );
  },
);
