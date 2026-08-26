import { lazy } from "react";

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
const loadBookDetailsDrawer = () =>
  import("./BookDetailsDrawer").then((module) => ({
    default: module.BookDetailsDrawer,
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

export const AddEpubDialog = lazy(loadAddEpubDialog);
export const MoveToFolderDialog = lazy(loadMoveToFolderDialog);
export const RenameFileDialog = lazy(loadRenameFileDialog);
export const BookDetailsDrawer = lazy(loadBookDetailsDrawer);
export const BookAdvancedMetadataDialog = lazy(loadBookAdvancedMetadataDialog);
export const BookCoverWritebackDialog = lazy(loadBookCoverWritebackDialog);
export const BulkMetadataDialog = lazy(loadBulkMetadataDialog);
export const FolderCreateDialog = lazy(loadFolderCreateDialog);
export const FolderRenameDialog = lazy(loadFolderRenameDialog);
export const SeriesDetail = lazy(loadSeriesDetail);
export const SeriesOverview = lazy(loadSeriesOverview);
export const LibraryDuplicatesView = lazy(loadLibraryDuplicatesView);
export const LibraryEpubIssuesView = lazy(loadLibraryEpubIssuesView);
