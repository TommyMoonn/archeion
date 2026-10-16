import { X } from "lucide-react";
import { forwardRef, useContext, useImperativeHandle, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "../../components/IconButton";
import { ReaderPanelFrameContext } from "./readerPanelFrameContext";

type ReaderSidePanelProps = {
  accessibleLabel: string;
  ariaBusy?: boolean;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  closeButtonRef?: Ref<HTMLButtonElement>;
  eyebrow: string;
  headerActions?: ReactNode;
  headerLeading?: ReactNode;
  hidden?: boolean;
  id?: string;
  ignoreReaderShortcuts?: boolean;
  onClose?: () => void;
  tabIndex?: number;
  title: string;
  titleId?: string;
};

export const ReaderSidePanel = forwardRef<HTMLElement, ReaderSidePanelProps>(
  function ReaderSidePanel(
    {
      accessibleLabel,
      ariaBusy,
      children,
      className = "",
      closeLabel,
      closeButtonRef,
      eyebrow,
      headerActions,
      headerLeading,
      hidden,
      id,
      ignoreReaderShortcuts = false,
      onClose,
      tabIndex,
      title,
      titleId,
    },
    ref,
  ) {
    const host = useContext(ReaderPanelFrameContext);
    if (host) {
      return (
        <HostedReaderPanel host={host} panelRef={ref} headerActions={headerActions}>
          {children}
        </HostedReaderPanel>
      );
    }
    return (
      <aside
        aria-busy={ariaBusy || undefined}
        aria-label={accessibleLabel}
        className={`reader-side-panel ${className}`.trim()}
        data-reader-ignore-shortcuts={ignoreReaderShortcuts || undefined}
        hidden={hidden}
        id={id}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        ref={ref}
        tabIndex={tabIndex}
      >
        <header className="reader-side-panel__header">
          {headerLeading ? (
            <div className="reader-side-panel__header-leading">{headerLeading}</div>
          ) : null}
          <div className="reader-side-panel__header-copy">
            <p>{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          {headerActions || onClose ? (
            <div className="reader-side-panel__header-actions">
              {headerActions}
              {onClose && closeLabel ? (
                <IconButton
                  label={closeLabel}
                  onClick={onClose}
                  ref={closeButtonRef}
                  size="compact"
                >
                  <X aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          ) : null}
        </header>
        {children}
      </aside>
    );
  },
);

function HostedReaderPanel({
  host,
  panelRef,
  headerActions,
  children,
}: {
  host: NonNullable<React.ContextType<typeof ReaderPanelFrameContext>>;
  panelRef: Ref<HTMLElement>;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  useImperativeHandle(panelRef, () => host.panelRef.current!, [host]);
  return (
    <>
      {host.actionsHost && headerActions ? createPortal(headerActions, host.actionsHost) : null}
      {children}
    </>
  );
}
