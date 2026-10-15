import {
  resolveReaderPresentation,
  type ReaderMode,
  type ReaderPresentation,
} from "../../types/reader";
import type { ReaderPublicationLayoutCapability } from "./readerSession";

export type ReaderControlCapabilities = Readonly<{
  contentAppearance: boolean;
  progressPlacement: boolean;
  readerTheme: boolean;
  readingMode: boolean;
}>;

const REFLOWABLE_CONTROLS: ReaderControlCapabilities = Object.freeze({
  contentAppearance: true,
  progressPlacement: true,
  readerTheme: true,
  readingMode: true,
});

const FIXED_LAYOUT_CONTROLS: ReaderControlCapabilities = Object.freeze({
  contentAppearance: false,
  progressPlacement: true,
  readerTheme: false,
  readingMode: false,
});

export function readerControlCapabilities(
  layoutCapability: ReaderPublicationLayoutCapability | null,
): ReaderControlCapabilities {
  return layoutCapability === "reflowable" ? REFLOWABLE_CONTROLS : FIXED_LAYOUT_CONTROLS;
}

export function readerModeForPublication(
  preferredMode: ReaderMode,
  layoutCapability: ReaderPublicationLayoutCapability | null,
): ReaderMode {
  return layoutCapability === "fixed-layout" ? "paged" : preferredMode;
}

export function readerPresentationForPublication(
  selection: unknown,
  layoutCapability: ReaderPublicationLayoutCapability | null,
): ReaderPresentation {
  return layoutCapability === "reflowable" ? resolveReaderPresentation(selection) : "publisher";
}
