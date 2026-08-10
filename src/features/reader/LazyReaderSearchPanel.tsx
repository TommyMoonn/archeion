import { lazy, Suspense, type RefObject } from "react";

import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";
import { ReaderSearchLoadingShell } from "./ReaderPanelLoadingShells";

const ReaderSearchPanel = lazy(() =>
  import("./ReaderSearchPanel").then((module) => ({ default: module.ReaderSearchPanel })),
);

type LazyReaderSearchPanelProps = {
  inputRef?: RefObject<HTMLInputElement | null>;
  onActivateResult: (resultId: string) => Promise<boolean>;
  onClose: () => void;
  onNextResult: () => Promise<boolean>;
  onPreviousResult: () => Promise<boolean>;
  onQueryChange: (query: string) => void;
  state: ReaderPublicationSearchControllerState;
};

export function LazyReaderSearchPanel(props: LazyReaderSearchPanelProps) {
  return (
    <Suspense fallback={<ReaderSearchLoadingShell onClose={props.onClose} />}>
      <ReaderSearchPanel {...props} />
    </Suspense>
  );
}
