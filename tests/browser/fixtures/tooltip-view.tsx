import { useState } from "react";
import { Dialog } from "../../../src/components/Dialog";
import { IconButton } from "../../../src/components/IconButton";
import { Tooltip, TooltipProvider, type TooltipPlacement } from "../../../src/components/Tooltip";

const longDescription =
  "A complete label that wraps without escaping the viewport: " + "longword".repeat(20);

export function TooltipFixture() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const placement = new URLSearchParams(window.location.search).get("placement");
  const side: TooltipPlacement =
    placement === "left" || placement === "right" || placement === "bottom" ? placement : "top";
  return (
    <TooltipProvider>
      <main className="reader-page" style={{ height: "100vh", padding: 24 }}>
        <Tooltip content={longDescription} placement={side}>
          <button
            type="button"
            style={{
              position: "fixed",
              width: 32,
              height: 32,
              ...(side === "top"
                ? { top: 8, left: 8 }
                : side === "bottom"
                  ? { bottom: 8, right: 8 }
                  : side === "left"
                    ? { left: 8, bottom: 8 }
                    : { right: 8, top: 8 }),
            }}
            aria-label="Edge tooltip"
          >
            ?
          </button>
        </Tooltip>
        <div style={{ margin: "auto", display: "grid", gap: 12, justifyItems: "start" }}>
          <button type="button" onClick={() => setDialogOpen(true)}>
            Open tooltip dialog
          </button>
          <Tooltip content="Full truncated label" onlyWhenTruncated="span">
            <button type="button">
              <span
                style={{
                  display: "block",
                  width: 48,
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                  overflow: "hidden",
                }}
              >
                Full truncated label
              </span>
            </button>
          </Tooltip>
          <Tooltip content="Short label" onlyWhenTruncated="span">
            <button type="button">
              <span>Short label</span>
            </button>
          </Tooltip>
          <IconButton label="Unavailable action" disabled disabledReason="Choose an archive first">
            ?
          </IconButton>
          <button type="button">After tooltip</button>
        </div>
        {dialogOpen && (
          <Dialog title="Tooltip dialog" onClose={() => setDialogOpen(false)}>
            <IconButton label="Modal help" tooltip="Modal explanation">
              ?
            </IconButton>
          </Dialog>
        )}
      </main>
    </TooltipProvider>
  );
}
