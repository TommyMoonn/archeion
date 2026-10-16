import type { ReaderNavigationState } from "../../types/reader";
import { ReaderPanelFrame } from "./ReaderPanelLoadingShells";
import { navigationPanelModule } from "./readerPanelModules";

type LazyReaderNavigationPanelProps = {
  navigation: ReaderNavigationState;
  onClose: () => void;
  onModuleReload: () => void;
  onNavigate: (itemId: string) => Promise<boolean>;
};

export function LazyReaderNavigationPanel(props: LazyReaderNavigationPanelProps) {
  const { Component, status } = navigationPanelModule.useModule();
  const readiness =
    status !== "ready"
      ? status
      : props.navigation.status === "loading"
        ? "loading"
        : props.navigation.chapters.length +
              props.navigation.landmarks.length +
              props.navigation.pageReferences.length ===
            0
          ? "empty"
          : "ready";
  return (
    <ReaderPanelFrame
      kind="navigation"
      onClose={props.onClose}
      readiness={readiness}
      onModuleReload={status === "error" ? props.onModuleReload : undefined}
    >
      {Component ? <Component {...props} /> : null}
    </ReaderPanelFrame>
  );
}
