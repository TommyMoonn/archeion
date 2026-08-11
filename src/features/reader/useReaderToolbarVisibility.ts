import { useCallback, useRef, useState } from "react";

type ReaderToolbarVisibility = {
  activate: () => void;
  deactivate: () => void;
  expanded: boolean;
  setSideSurfaceOwned: (owned: boolean) => void;
  toggle: () => void;
};

export function useReaderToolbarVisibility(): ReaderToolbarVisibility {
  const [expanded, setExpanded] = useState(true);
  const sideSurfaceOwnedRef = useRef(false);

  const activate = useCallback(() => {
    setExpanded(true);
  }, []);

  const deactivate = useCallback(() => {
    setExpanded(true);
  }, []);

  const setSideSurfaceOwned = useCallback((owned: boolean) => {
    sideSurfaceOwnedRef.current = owned;
    if (owned) setExpanded(true);
  }, []);

  const toggle = useCallback(() => {
    setExpanded((current) => (sideSurfaceOwnedRef.current ? true : !current));
  }, []);

  return {
    activate,
    deactivate,
    expanded,
    setSideSurfaceOwned,
    toggle,
  };
}
