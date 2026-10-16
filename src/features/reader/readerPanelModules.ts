import type { ComponentProps } from "react";
import type { ReaderNavigationPanel } from "./ReaderNavigationPanel";
import type { ReaderSearchPanel } from "./ReaderSearchPanel";
import type { ReaderAnnotationsPanel } from "./ReaderAnnotationsPanel";
import { createReaderPanelModule } from "./readerPanelModule";

export const navigationPanelModule = createReaderPanelModule<
  ComponentProps<typeof ReaderNavigationPanel>
>(() =>
  import("./ReaderNavigationPanel").then((module) => ({ default: module.ReaderNavigationPanel })),
);
export const searchPanelModule = createReaderPanelModule<ComponentProps<typeof ReaderSearchPanel>>(
  () => import("./ReaderSearchPanel").then((module) => ({ default: module.ReaderSearchPanel })),
);
export const annotationsPanelModule = createReaderPanelModule<
  ComponentProps<typeof ReaderAnnotationsPanel>
>(() =>
  import("./ReaderAnnotationsPanel").then((module) => ({ default: module.ReaderAnnotationsPanel })),
);
