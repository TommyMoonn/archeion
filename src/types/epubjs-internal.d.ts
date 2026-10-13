declare module "epubjs/src/epubcfi.js" {
  export { default } from "epubjs/types/epubcfi";
}

declare module "epubjs/src/navigation.js" {
  export { default } from "epubjs/types/navigation";
}

// The residency adapter is verified against the installed 0.3.93 implementation.
declare module "epubjs/src/managers/continuous/index.js" {
  import type Section from "epubjs/types/section";
  import type Contents from "epubjs/types/contents";
  import Manager from "epubjs/types/managers/manager";
  export type ResidentView = {
    section: Section;
    element: HTMLElement;
    contents?: Contents;
    displayed: boolean;
    display(request: unknown): Promise<ResidentView>;
    show(): void;
    destroy(): void;
  };
  type ContinuousManagerBoundary = {
    container: HTMLElement;
    settings: { offset: number; axis?: string; direction?: string };
    request: unknown;
    views: { all(): ResidentView[] };
    display(section: Section, target?: string | number): Promise<void>;
    append(section: Section): ResidentView;
    update(offset?: number): Promise<unknown>;
    trim(): Promise<unknown>;
    erase(view: ResidentView, above?: boolean): void;
    destroy(): void;
  };
  const ContinuousViewManager: new (
    options: object,
  ) => Omit<Manager, "display" | "destroy"> & ContinuousManagerBoundary;
  export default ContinuousViewManager;
}
