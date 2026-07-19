import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

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
