import { lazy, Suspense, type RefObject } from "react";

import type { ReaderNavigationState } from "../../types/reader";
import { ReaderTocLoadingShell } from "./ReaderPanelLoadingShells";

const ReaderTocPanel = lazy(() =>
  import("./ReaderTocPanel").then((module) => ({ default: module.ReaderTocPanel })),
);

type LazyReaderTocPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onNavigate: (chapterId: string) => Promise<boolean>;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
};

export function LazyReaderTocPanel(props: LazyReaderTocPanelProps) {
  return (
    <Suspense fallback={<ReaderTocLoadingShell onClose={props.onClose} />}>
      <ReaderTocPanel {...props} />
    </Suspense>
  );
}
