import { FolderOpen, Lightning, SidebarSimple } from "@phosphor-icons/react";
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

import { IconButton } from "../../components/IconButton";
import { WindowTitlebarAppActions } from "../../components/WindowTitlebar";

type LibraryTitlebarCompositionProps = {
  collapseAvailable: boolean;
  collapsed: boolean;
  expandedSidebarContentRef: RefObject<HTMLDivElement | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenQuickActions: () => void;
  onRevealArchive: () => void;
  quickActionsAriaKeyShortcuts?: string;
  revealArchiveDisabledReason?: string;
};

type TitlebarFocusOwner = "collapse" | "quick-actions" | "reveal";

export function LibraryTitlebarComposition({
  collapseAvailable,
  collapsed,
  expandedSidebarContentRef,
  onCollapsedChange,
  onOpenQuickActions,
  onRevealArchive,
  quickActionsAriaKeyShortcuts,
  revealArchiveDisabledReason,
}: LibraryTitlebarCompositionProps) {
  const collapseControlRef = useRef<HTMLButtonElement>(null);
  const quickActionsControlRef = useRef<HTMLButtonElement>(null);
  const revealControlRef = useRef<HTMLButtonElement>(null);
  const removedFocusOwnerRef = useRef<TitlebarFocusOwner | null>(null);
  const isCollapsed = collapsed && collapseAvailable;
  const previousResponsiveStateRef = useRef({ collapseAvailable, isCollapsed });

  const setCollapseControlRef = useCallback((control: HTMLButtonElement | null) => {
    captureRemovedFocusOwner(collapseControlRef, control, "collapse", removedFocusOwnerRef);
  }, []);
  const setQuickActionsControlRef = useCallback((control: HTMLButtonElement | null) => {
    captureRemovedFocusOwner(
      quickActionsControlRef,
      control,
      "quick-actions",
      removedFocusOwnerRef,
    );
  }, []);
  const setRevealControlRef = useCallback((control: HTMLButtonElement | null) => {
    captureRemovedFocusOwner(revealControlRef, control, "reveal", removedFocusOwnerRef);
  }, []);

  useLayoutEffect(() => {
    const previousState = previousResponsiveStateRef.current;
    const removedFocusOwner = removedFocusOwnerRef.current;

    if (
      !previousState.isCollapsed &&
      isCollapsed &&
      (removedFocusOwner === "reveal" || removedFocusOwner === "quick-actions")
    ) {
      collapseControlRef.current?.focus({ preventScroll: true });
    } else if (
      previousState.collapseAvailable &&
      !collapseAvailable &&
      removedFocusOwner === "collapse"
    ) {
      quickActionsControlRef.current?.focus({ preventScroll: true });
    }

    previousResponsiveStateRef.current = { collapseAvailable, isCollapsed };
    removedFocusOwnerRef.current = null;
  }, [collapseAvailable, isCollapsed]);

  const toggleSidebar = useCallback(() => {
    const nextCollapsed = !isCollapsed;
    if (
      nextCollapsed &&
      expandedSidebarContentRef.current?.contains(
        expandedSidebarContentRef.current.ownerDocument.activeElement,
      )
    ) {
      collapseControlRef.current?.focus({ preventScroll: true });
    }
    onCollapsedChange(nextCollapsed);
  }, [expandedSidebarContentRef, isCollapsed, onCollapsedChange]);

  return (
    <WindowTitlebarAppActions>
      <div
        className="library-titlebar-composition"
        data-collapse-available={collapseAvailable}
        data-sidebar-collapsed={isCollapsed}
      >
        {!isCollapsed ? (
          <span className="library-titlebar-composition__wordmark">Archeion</span>
        ) : null}
        <div
          aria-label="Library window actions"
          className="library-titlebar-composition__actions"
          role="group"
        >
          {!isCollapsed ? (
            <>
              <IconButton
                className="library-titlebar-composition__button"
                disabled={Boolean(revealArchiveDisabledReason)}
                disabledReason={revealArchiveDisabledReason}
                label="Reveal active archive folder"
                onClick={onRevealArchive}
                ref={setRevealControlRef}
                size="compact"
                tooltip="Reveal active archive folder"
                tooltipPlacement="bottom"
              >
                <FolderOpen aria-hidden="true" weight="regular" />
              </IconButton>
              <IconButton
                aria-keyshortcuts={quickActionsAriaKeyShortcuts}
                className="library-titlebar-composition__button library-titlebar-composition__quick-action"
                label="Open Quick Actions"
                onClick={onOpenQuickActions}
                ref={setQuickActionsControlRef}
                size="compact"
                tooltip="Open Quick Actions"
                tooltipPlacement="bottom"
              >
                <Lightning aria-hidden="true" weight="regular" />
              </IconButton>
            </>
          ) : null}
          {collapseAvailable ? (
            <IconButton
              className="library-titlebar-composition__button"
              data-sidebar-direction={isCollapsed ? "expand-right" : "collapse-left"}
              key="sidebar-toggle"
              label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
              ref={setCollapseControlRef}
              size="compact"
              tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              tooltipPlacement="bottom"
            >
              <SidebarSimple
                aria-hidden="true"
                className="library-titlebar-composition__sidebar-icon"
                weight="regular"
              />
            </IconButton>
          ) : null}
        </div>
      </div>
    </WindowTitlebarAppActions>
  );
}

function captureRemovedFocusOwner(
  controlRef: RefObject<HTMLButtonElement | null>,
  nextControl: HTMLButtonElement | null,
  owner: TitlebarFocusOwner,
  removedFocusOwnerRef: RefObject<TitlebarFocusOwner | null>,
): void {
  const previousControl = controlRef.current;
  if (!nextControl && previousControl?.ownerDocument.activeElement === previousControl) {
    removedFocusOwnerRef.current = owner;
  }
  controlRef.current = nextControl;
}
