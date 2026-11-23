import { useEffect } from "react";

import { MAIN_CONTENT_ID, SkipLink } from "../components/SkipLink";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { revealColdStartReaderWindow } from "./coldStartEpubClient";

export function StandaloneReaderStartup({ filePath }: { filePath: string | null }) {
  useEffect(() => {
    void revealColdStartReaderWindow().catch((error: unknown) => {
      console.error("Unable to reveal standalone Reader window", error);
    });
  }, []);

  const fileName = filePath?.split(/[\\/]/).at(-1);
  return (
    <div className="window-app">
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <WindowTitlebar canMaximize />
      <div className="window-app__content">
        <main className="reader-status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
          {fileName ? (
            <>
              <h1>{fileName}</h1>
              <p>EPUB selected. Standalone reading will be available in a later phase.</p>
            </>
          ) : (
            <>
              <h1>Unable to read the launch request</h1>
              <p role="alert">Close Archeion and try opening the EPUB again.</p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
