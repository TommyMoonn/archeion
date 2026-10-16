import { type RefObject } from "react";

import type { ReaderPublicationSearchControllerState } from "./useReaderPublicationSearch";
import { ReaderPanelFrame } from "./ReaderPanelLoadingShells";
import { searchPanelModule } from "./readerPanelModules";

type LazyReaderSearchPanelProps = {
  inputRef?: RefObject<HTMLInputElement | null>;
  onActivateResult: (resultId: string) => Promise<boolean>;
  onClose: () => void;
  onModuleReload: () => void;
  onNextResult: () => Promise<boolean>;
  onPreviousResult: () => Promise<boolean>;
  onQueryChange: (query: string) => void;
  state: ReaderPublicationSearchControllerState;
};

export function LazyReaderSearchPanel(props: LazyReaderSearchPanelProps) {
  const { Component, status } = searchPanelModule.useModule();
  const readiness =
    status !== "ready"
      ? status
      : props.state.status === "searching"
        ? "loading"
        : props.state.status === "ready" && props.state.results.length === 0
          ? "empty"
          : props.state.status;
  return (
    <ReaderPanelFrame
      kind="search"
      onClose={props.onClose}
      readiness={readiness}
      onModuleReload={status === "error" ? props.onModuleReload : undefined}
    >
      {Component ? <Component {...props} /> : null}
    </ReaderPanelFrame>
  );
}
