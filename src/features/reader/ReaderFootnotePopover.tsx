import { X } from "lucide-react";
import { createElement, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { IconButton } from "../../components/IconButton";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
import type { EpubContentAction } from "./epubContentActions";
import type { EpubFootnoteNode, ResolvedEpubFootnote } from "./epubFootnoteResolver";
import { placeReaderFootnote, type ReaderFootnotePlacement } from "./readerContentActionAnchor";
import type { ClientRect } from "./readerHighlightPaletteAnchor";
import { trapReaderPopoverFocus } from "./readerPopoverFocus";
import { useReaderSideSurfaceDismiss } from "./readerSideSurfaceDismissal";

type ReaderFootnotePopoverProps = {
  anchorRect: ClientRect;
  content?: ResolvedEpubFootnote;
  message?: string;
  onAction: (action: Exclude<EpubContentAction, { kind: "unsupported" }>) => void;
  onDismiss: (restoreFocus?: boolean) => void;
  viewportRect: ClientRect;
};

export function ReaderFootnotePopover({
  anchorRect,
  content,
  message,
  onAction,
  onDismiss,
  viewportRect,
}: ReaderFootnotePopoverProps) {
  const popoverRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ height: 180, width: 360 });
  const dismissal = useReaderSideSurfaceDismiss(
    (restoreFocus = true) => {
      onDismiss(restoreFocus);
      return true;
    },
    true,
    "footnote",
  );

  useTransientSurfaceOwnership({
    closeOnModalOpen: !dismissal.readerOwned,
    dismissOnOutsidePointer: true,
    elementRef: popoverRef,
    kind: "popover",
    onDismiss: (reason) => (reason === "escape" ? dismissal.requestDismissal() : onDismiss(false)),
  });

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const measure = () => {
      const bounds = popover.getBoundingClientRect();
      setSize({ height: bounds.height, width: bounds.width });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(popover);
    return () => observer?.disconnect();
  }, [content, message]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const placement = placeReaderFootnote(anchorRect, viewportRect, size);
  if (!placement) return null;

  return (
    <aside
      ref={popoverRef}
      aria-label="Footnote"
      className="reader-footnote"
      data-placement={placement.placement}
      data-reader-ignore-shortcuts
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => trapReaderPopoverFocus(event, popoverRef.current)}
      onPointerDown={(event) => event.stopPropagation()}
      role="dialog"
      style={placementStyle(placement)}
    >
      <header className="reader-footnote__header">
        <span>Footnote</span>
        <IconButton
          label="Close footnote"
          onClick={() => dismissal.requestDismissal()}
          ref={closeRef}
          size="compact"
        >
          <X aria-hidden="true" />
        </IconButton>
      </header>
      <div className="reader-footnote__content">
        {content ? renderNodes(content.nodes, onAction) : <p>{message}</p>}
      </div>
    </aside>
  );
}

function renderNodes(
  nodes: readonly EpubFootnoteNode[],
  onAction: ReaderFootnotePopoverProps["onAction"],
): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, `${index}`, onAction));
}

function renderNode(
  node: EpubFootnoteNode,
  key: string,
  onAction: ReaderFootnotePopoverProps["onAction"],
): ReactNode {
  switch (node.type) {
    case "text":
      return node.text;
    case "image":
      return <img alt={node.alt} className="reader-footnote__image" key={key} src={node.src} />;
    case "link":
      return (
        <button
          className="reader-footnote__link"
          key={key}
          onClick={() => onAction(node.action)}
          type="button"
        >
          {renderNodes(node.children, onAction)}
        </button>
      );
    case "element":
      return node.tag === "br"
        ? createElement("br", { key })
        : createElement(node.tag, { key }, renderNodes(node.children, onAction));
  }
}

function placementStyle(placement: ReaderFootnotePlacement) {
  return { left: placement.left, top: placement.top };
}
