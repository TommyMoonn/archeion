import { lazy, Suspense } from "react";

import type { ReaderNavigationState } from "../../types/reader";
import { ReaderNavigationLoadingShell } from "./ReaderPanelLoadingShells";

const ReaderNavigationPanel = lazy(() =>
  import("./ReaderNavigationPanel").then((module) => ({
    default: module.ReaderNavigationPanel,
  })),
);

type LazyReaderNavigationPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onNavigate: (itemId: string) => Promise<boolean>;
};

export function LazyReaderNavigationPanel(props: LazyReaderNavigationPanelProps) {
  return (
    <Suspense fallback={<ReaderNavigationLoadingShell onClose={props.onClose} />}>
      <ReaderNavigationPanel {...props} />
    </Suspense>
  );
}
