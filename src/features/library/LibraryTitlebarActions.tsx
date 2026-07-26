import { FolderOpen, Lightning, SidebarSimple } from "@phosphor-icons/react";
import { useCallback, useRef, type RefObject } from "react";

import { IconButton } from "../../components/IconButton";
import { WindowTitlebarAppActions } from "../../components/WindowTitlebar";

type LibraryTitlebarActionsProps = {
  collapseAvailable: boolean;
  collapsed: boolean;
  expandedSidebarContentRef: RefObject<HTMLDivElement | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenQuickActions: () => void;
  onRevealArchive: () => void;
  quickActionsAriaKeyShortcuts?: string;
  revealArchiveDisabledReason?: string;
};

export function LibraryTitlebarActions({
  collapseAvailable,
  collapsed,
  expandedSidebarContentRef,
  onCollapsedChange,
  onOpenQuickActions,
  onRevealArchive,
  quickActionsAriaKeyShortcuts,
  revealArchiveDisabledReason,
}: LibraryTitlebarActionsProps) {
  const collapseControlRef = useRef<HTMLButtonElement>(null);
  const toggleSidebar = useCallback(() => {
    const nextCollapsed = !collapsed;
    if (
      nextCollapsed &&
      expandedSidebarContentRef.current?.contains(
        expandedSidebarContentRef.current.ownerDocument.activeElement,
      )
    ) {
      collapseControlRef.current?.focus({ preventScroll: true });
    }
    onCollapsedChange(nextCollapsed);
  }, [collapsed, expandedSidebarContentRef, onCollapsedChange]);

  return (
    <WindowTitlebarAppActions>
      <div aria-label="Library window actions" className="library-titlebar-actions" role="group">
        {collapseAvailable ? (
          <IconButton
            className="library-titlebar-actions__button"
            data-sidebar-direction={collapsed ? "expand-right" : "collapse-left"}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
            ref={collapseControlRef}
            size="standard"
          >
            <SidebarSimple
              aria-hidden="true"
              className="library-titlebar-actions__sidebar-icon"
              weight="regular"
            />
          </IconButton>
        ) : null}
        <IconButton
          aria-keyshortcuts={quickActionsAriaKeyShortcuts}
          className="library-titlebar-actions__button library-titlebar-actions__quick-action"
          label="Open Quick Actions"
          onClick={onOpenQuickActions}
          size="standard"
        >
          <Lightning aria-hidden="true" weight="regular" />
        </IconButton>
        <IconButton
          className="library-titlebar-actions__button"
          disabled={Boolean(revealArchiveDisabledReason)}
          disabledReason={revealArchiveDisabledReason}
          label="Reveal active archive folder"
          onClick={onRevealArchive}
          size="standard"
        >
          <FolderOpen aria-hidden="true" weight="regular" />
        </IconButton>
      </div>
    </WindowTitlebarAppActions>
  );
}
