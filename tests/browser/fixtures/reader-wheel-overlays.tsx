import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReaderSidePanel } from "../../../src/features/reader/ReaderSidePanel";
import { ReaderSideSurfaceLayer } from "../../../src/features/reader/ReaderSideSurfaceLayer";
import { ReaderFootnotePopover } from "../../../src/features/reader/ReaderFootnotePopover";
import { ReaderIllustrationViewer } from "../../../src/features/reader/ReaderIllustrationViewer";
import "../../../src/styles/features/reader.css";
import "../../../src/styles/features/reader-content-actions.css";

/** Real production surfaces over the real renderer; no archive or app-shell state. */
export function mountWheelOverlay(
  kind:
    | "search"
    | "annotations"
    | "navigation"
    | "settings"
    | "footnote"
    | "illustration"
    | "illustration-loading",
) {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText =
    "position:fixed;inset:0;z-index:20;pointer-events:none;--reader-header-clearance:0px;--reader-bg:white;--reader-text:black;--reader-line:gray;--type-body:16px;--font-ui:serif";
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.unmount();
    host.remove();
  };
  const paragraphs = Array.from({ length: 80 }, (_, i) => <p key={i}>Original surface row {i}.</p>);
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 600;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#53778c";
  context.fillRect(0, 0, 400, 600);
  const url = canvas.toDataURL("image/png");
  const bytes = Uint8Array.from(atob(url.split(",")[1]), (character) => character.charCodeAt(0));
  const resource = {
    blob: new Blob([bytes], { type: "image/png" }),
    byteLength: bytes.length,
    height: 600,
    width: 400,
    href: "fixture.png",
    mediaType: "image/png" as const,
    release: () => undefined,
    url,
  };
  flushSync(() =>
    root.render(
      <div style={{ pointerEvents: "auto" }}>
        {kind.startsWith("illustration") ? (
          <ReaderIllustrationViewer
            loading={kind === "illustration-loading"}
            resource={kind === "illustration" ? resource : undefined}
            onClose={close}
          />
        ) : kind === "footnote" ? (
          <ReaderFootnotePopover
            anchorRect={{ left: 300, right: 400, top: 150, bottom: 170, width: 100, height: 20 }}
            viewportRect={{
              left: 0,
              right: innerWidth,
              top: 0,
              bottom: innerHeight,
              width: innerWidth,
              height: innerHeight,
            }}
            content={{
              nodes: Array.from({ length: 80 }, (_, i) => ({
                type: "element",
                tag: "p",
                children: [{ type: "text", text: `Original footnote row ${i}.` }],
              })),
              release: () => undefined,
            }}
            onAction={() => undefined}
            onDismiss={close}
          />
        ) : (
          <ReaderSideSurfaceLayer onDismiss={close}>
            <ReaderSidePanel
              accessibleLabel={kind}
              title={kind}
              eyebrow="Reader"
              ignoreReaderShortcuts
              closeLabel="Close test panel"
              onClose={close}
            >
              <div className="reader-panel-scroll">{paragraphs}</div>
            </ReaderSidePanel>
          </ReaderSideSurfaceLayer>
        )}
      </div>,
    ),
  );
  return close;
}
