import { useEffect, useLayoutEffect } from "react";
import {
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
} from "react-router-dom";

export type LibraryPageRouteChange = Readonly<{
  navigationType: string;
  search: string;
}>;

export function LibraryPageRouteProbe({
  onChange,
}: {
  onChange: (route: LibraryPageRouteChange) => void;
}) {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    onChange({ navigationType, search: location.search });
  }, [location.search, navigationType, onChange]);
  return null;
}

export function LibraryPageNavigateProbe({
  onReady,
}: {
  onReady: (navigate: NavigateFunction) => void;
}) {
  const navigate = useNavigate();
  useLayoutEffect(() => onReady(navigate), [navigate, onReady]);
  return null;
}
