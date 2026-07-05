import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Book as EpubBook, Rendition, Location } from "epubjs";

import type { ReaderSettings } from "../../types/reader";
import {
  normalizeReaderLocation,
  type ReaderLocation,
} from "./readerLocation";
import { readerThemeForSettings } from "./readerTheme";

export type EpubViewerHandle = {
  next: () => Promise<void>;
  previous: () => Promise<void>;
};

type EpubViewerProps = {
  fileBlob: Blob;
  initialCfi?: string;
  onError: (message: string) => void;
  onInteraction: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onLocationChange: (location: ReaderLocation) => void;
  onReady: () => void;
  settings: ReaderSettings;
};

export const EpubViewer = forwardRef<EpubViewerHandle, EpubViewerProps>(
  function EpubViewer(
    {
      fileBlob,
      initialCfi,
      onError,
      onInteraction,
      onKeyDown,
      onLocationChange,
      onReady,
      settings,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const settingsRef = useRef(settings);
    const [isLoading, setIsLoading] = useState(true);
    settingsRef.current = settings;

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

          const currentSettings = settingsRef.current;
          rendition = epubBook.renderTo(containerRef.current, {
            width: "100%",
            height: "100%",
            flow:
              currentSettings.flowMode === "scrolled"
                ? "scrolled-doc"
                : "paginated",
            spread: "none",
            allowScriptedContent: false,
          });
          renditionRef.current = rendition;
          rendition.themes.register(
            "archeion-reader",
            readerThemeForSettings(currentSettings),
          );
          rendition.themes.select("archeion-reader");
          rendition.on("keydown", onKeyDown);
          rendition.on("mousemove", onInteraction);
          rendition.on("touchstart", onInteraction);
          rendition.on("click", onInteraction);
          rendition.on("relocated", onRelocated);

          try {
            await rendition.display(initialCfi);
          } catch {
            await rendition.display();
          }
          void epubBook.locations.generate(1600).catch(() => {
            // Reading can continue without a calculated percentage.
          });

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
          rendition.off("mousemove", onInteraction);
          rendition.off("touchstart", onInteraction);
          rendition.off("click", onInteraction);
          rendition.off("relocated", onRelocated);
        }

        renditionRef.current = null;
        epubBook?.destroy();
      };
    }, [
      fileBlob,
      initialCfi,
      onError,
      onInteraction,
      onKeyDown,
      onLocationChange,
      onReady,
    ]);

    useEffect(() => {
      const rendition = renditionRef.current;
      if (!rendition) {
        return;
      }

      rendition.themes.register(
        "archeion-reader",
        readerThemeForSettings(settings),
      );
      rendition.themes.select("archeion-reader");
    }, [settings]);

    useEffect(() => {
      renditionRef.current?.flow(
        settings.flowMode === "scrolled" ? "scrolled-doc" : "paginated",
      );
    }, [settings.flowMode]);

    return (
      <div className="epub-viewer" data-reader-theme={settings.theme}>
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
