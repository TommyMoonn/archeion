import { createElement } from "react";
import { createAsyncSurface } from "../../components/createAsyncSurface";
import {
  IntegrityViewFallback,
  SeriesOverviewFallback,
  SeriesDetailFallback,
} from "./LibrarySecondaryViewFallback";
export { BookDetailsDrawer } from "./LazyBookDetailsDrawer";

const loadAddEpubDialog = () =>
  import("../filesystem/AddEpubDialog").then((module) => ({
    default: module.AddEpubDialog,
  }));
const loadMoveToFolderDialog = () =>
  import("../filesystem/MoveToFolderDialog").then((module) => ({
    default: module.MoveToFolderDialog,
  }));
const loadRenameFileDialog = () =>
  import("../filesystem/RenameFileDialog").then((module) => ({
    default: module.RenameFileDialog,
  }));
const loadBookAdvancedMetadataDialog = () =>
  import("./BookAdvancedMetadataDialog").then((module) => ({
    default: module.BookAdvancedMetadataDialog,
  }));
const loadBookCoverWritebackDialog = () =>
  import("./BookCoverWritebackDialog").then((module) => ({
    default: module.BookCoverWritebackDialog,
  }));
const loadBulkMetadataDialog = () =>
  import("./BulkMetadataDialog").then((module) => ({ default: module.BulkMetadataDialog }));
const loadFolderCreateDialog = () =>
  import("../folders/FolderCreateDialog").then((module) => ({
    default: module.FolderCreateDialog,
  }));
const loadFolderRenameDialog = () =>
  import("../folders/FolderRenameDialog").then((module) => ({
    default: module.FolderRenameDialog,
  }));
const loadSeriesDetail = () =>
  import("../series/SeriesDetail").then((module) => ({ default: module.SeriesDetail }));
const loadSeriesOverview = () =>
  import("../series/SeriesOverview").then((module) => ({ default: module.SeriesOverview }));
const loadLibraryDuplicatesView = () =>
  import("./LibraryDuplicatesView").then((module) => ({
    default: module.LibraryDuplicatesView,
  }));
const loadLibraryEpubIssuesView = () =>
  import("./LibraryEpubIssuesView").then((module) => ({
    default: module.LibraryEpubIssuesView,
  }));

export const AddEpubDialog = createAsyncSurface(loadAddEpubDialog);
export const MoveToFolderDialog = createAsyncSurface(loadMoveToFolderDialog);
export const RenameFileDialog = createAsyncSurface(loadRenameFileDialog);
export const BookAdvancedMetadataDialog = createAsyncSurface(loadBookAdvancedMetadataDialog);
export const BookCoverWritebackDialog = createAsyncSurface(loadBookCoverWritebackDialog);
export const BulkMetadataDialog = createAsyncSurface(loadBulkMetadataDialog);
export const FolderCreateDialog = createAsyncSurface(loadFolderCreateDialog);
export const FolderRenameDialog = createAsyncSurface(loadFolderRenameDialog);
export const SeriesDetail = createAsyncSurface(loadSeriesDetail, (props, retry) =>
  createElement(SeriesDetailFallback, { ...props, onRetry: retry }),
);
export const SeriesOverview = createAsyncSurface(loadSeriesOverview, (props, retry) =>
  createElement(SeriesOverviewFallback, {
    ...props,
    resultLabel: "Series unavailable",
    onRetry: retry,
  }),
);
export const LibraryDuplicatesView = createAsyncSurface(loadLibraryDuplicatesView, (props, retry) =>
  createElement(IntegrityViewFallback, {
    kind: "duplicates",
    refreshing: false,
    onRefresh: props.onRefresh,
    resultLabel: "View unavailable",
    onRetry: retry,
  }),
);
export const LibraryEpubIssuesView = createAsyncSurface(loadLibraryEpubIssuesView, (props, retry) =>
  createElement(IntegrityViewFallback, {
    kind: "epub-issues",
    refreshing: false,
    onRefresh: props.onRefresh,
    resultLabel: "View unavailable",
    onRetry: retry,
  }),
);
