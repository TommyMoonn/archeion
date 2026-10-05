import { PanelLeft } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

import { IconButton } from "../../components/IconButton";
import { WindowTitlebarAppActions } from "../../components/WindowTitlebar";
import { librarySidebarToggleLabel } from "./useLibrarySidebarState";

type LibraryTitlebarCompositionProps = {
  collapseAvailable: boolean;
  collapsed: boolean;
  expandedSidebarContentRef: RefObject<HTMLDivElement | null>;
  sidebarNavigationRef: RefObject<HTMLElement | null>;
  onCollapsedChange: (collapsed: boolean) => void;
  sidebarToggleAriaKeyShortcuts?: string;
};

export type LibraryTitlebarCompositionHandle = {
  toggleSidebar: () => void;
};

export const LibraryTitlebarComposition = forwardRef<
  LibraryTitlebarCompositionHandle,
  LibraryTitlebarCompositionProps
>(function LibraryTitlebarComposition(
  {
    collapseAvailable,
    collapsed,
    expandedSidebarContentRef,
    sidebarNavigationRef,
    onCollapsedChange,
    sidebarToggleAriaKeyShortcuts,
  },
  ref,
) {
  const collapseControlRef = useRef<HTMLButtonElement>(null);
  const removedFocusedControlRef = useRef(false);
  const isCollapsed = collapsed && collapseAvailable;
  const sidebarToggleLabel = librarySidebarToggleLabel(isCollapsed);

  const setCollapseControlRef = useCallback((control: HTMLButtonElement | null) => {
    const previousControl = collapseControlRef.current;
    if (!control && previousControl?.ownerDocument.activeElement === previousControl) {
      removedFocusedControlRef.current = true;
    }
    collapseControlRef.current = control;
  }, []);

  useLayoutEffect(() => {
    if (!collapseAvailable && removedFocusedControlRef.current) {
      const navigation = sidebarNavigationRef.current;
      const target =
        navigation?.querySelector<HTMLButtonElement>('button[aria-current="page"]') ??
        navigation?.querySelector<HTMLButtonElement>("button");
      target?.focus({ preventScroll: true });
    }
    removedFocusedControlRef.current = false;
  }, [collapseAvailable, sidebarNavigationRef]);

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
  useImperativeHandle(ref, () => ({ toggleSidebar }), [toggleSidebar]);

  return (
    <WindowTitlebarAppActions presentation={collapseAvailable ? "split" : undefined}>
      <div
        className="library-titlebar-composition"
        data-collapse-available={collapseAvailable}
        data-sidebar-collapsed={isCollapsed}
      >
        <div className="library-titlebar-composition__drag-region" data-tauri-drag-region />
        {!isCollapsed ? (
          <span className="library-titlebar-composition__wordmark" data-tauri-drag-region>
            Archeion
          </span>
        ) : null}
        {collapseAvailable ? (
          <div
            aria-label="Library window actions"
            className="library-titlebar-composition__actions"
            role="group"
          >
            <IconButton
              aria-keyshortcuts={sidebarToggleAriaKeyShortcuts}
              className="library-titlebar-composition__button"
              data-sidebar-direction={isCollapsed ? "expand-right" : "collapse-left"}
              key="sidebar-toggle"
              label={sidebarToggleLabel}
              onClick={toggleSidebar}
              ref={setCollapseControlRef}
              size="compact"
              tooltip={sidebarToggleLabel}
              tooltipPlacement="bottom"
            >
              <PanelLeft
                aria-hidden="true"
                className="library-titlebar-composition__sidebar-icon"
              />
            </IconButton>
          </div>
        ) : null}
      </div>
    </WindowTitlebarAppActions>
  );
});
