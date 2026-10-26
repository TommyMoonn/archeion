import type { LibrarySnapshotBook, LibrarySnapshotFolder } from "../../storage/LibraryStorage";
import type { GlobalImportSettings } from "../../types/settings";
import { AddEpubDialogFields } from "../filesystem/AddEpubDialogFields";
import { EpubFileNameFields } from "../filesystem/EpubFileNameFields";
import { getEpubNameStem } from "../filesystem/epubFileName";
import { MoveToFolderFields } from "../filesystem/MoveToFolderFields";
import { moveDestinationOptions } from "../filesystem/moveDestinationOptions";
import {
  ARCHIVE_ROOT_DESTINATION,
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  isEpubSourcePath,
} from "../filesystem/archiveImport";
import { FolderNameFields } from "../folders/FolderNameFields";
import { CoverWritebackFields } from "./CoverWritebackFields";
import { MetadataDialogFields } from "./MetadataDialogFields";
import { formStateFromMetadata } from "./metadataDialogModel";
import { BulkMetadataFields } from "./BulkMetadataFields";
import { initialBulkMetadata } from "./bulkMetadataDialogModel";
import type { LibraryWorkspaceDialog } from "./useLibraryWorkspaceDialogs";

const noop = () => {};
const asyncNoop = async () => {};
const preventSubmit = (event: { preventDefault: () => void }) => event.preventDefault();

/** Reuse each form's presentation, without importing its asynchronous operation controller. */
export function LibraryDialogSkeleton({
  dialog,
  books,
  folders,
  importDefaults,
  selectedBooks,
}: {
  dialog: LibraryWorkspaceDialog;
  books: readonly LibrarySnapshotBook[];
  folders: readonly LibrarySnapshotFolder[];
  importDefaults: GlobalImportSettings;
  selectedBooks: readonly LibrarySnapshotBook[];
}) {
  if (dialog.type === "add-epub") {
    const destinations = createArchiveDestinationOptions(folders);
    const requested = destinationValueFromFolderPath(dialog.droppedImport?.destinationFolderPath);
    const destinationValue = destinations.some((option) => option.value === requested)
      ? requested
      : ARCHIVE_ROOT_DESTINATION;
    return (
      <AddEpubDialogFields
        sourcePaths={(dialog.droppedImport?.sourcePaths ?? []).filter(isEpubSourcePath)}
        destinations={destinations}
        destinationValue={destinationValue}
        conflictAction={importDefaults.defaultConflictAction}
        mode={importDefaults.defaultMode}
        chooseFiles={asyncNoop}
        setDestinationValue={noop}
        setConflictAction={noop}
        setMode={noop}
      />
    );
  }
  if (dialog.type === "create-folder" || dialog.type === "rename-folder")
    return (
      <FolderNameFields
        formId="loading-folder-form"
        handleSubmit={preventSubmit}
        validationError={null}
        validationErrorId="loading-folder-error"
        name={dialog.type === "rename-folder" ? dialog.folder.name : ""}
        onNameChange={noop}
      />
    );
  if (dialog.type === "rename-book")
    return (
      <EpubFileNameFields
        formId="loading-epub-name-form"
        handleSubmit={preventSubmit}
        suffixId="loading-epub-suffix"
        validationError={null}
        validationErrorId="loading-epub-name-error"
        fileNameStem={getEpubNameStem(dialog.book.fileName)}
        onNameChange={noop}
      />
    );
  if (dialog.type === "move-book" || dialog.type === "move-folder" || dialog.type === "bulk-move") {
    const current =
      dialog.type === "move-book"
        ? dialog.book.folderId
        : dialog.type === "move-folder"
          ? dialog.folder.parentId
          : null;
    return (
      <MoveToFolderFields
        options={moveDestinationOptions(folders)}
        destination={current ?? ARCHIVE_ROOT_DESTINATION}
        setDestination={noop}
      />
    );
  }
  if (dialog.type === "book-metadata" || dialog.type === "book-cover") {
    const book = books.find((candidate) => candidate.id === dialog.bookId);
    if (!book) return null;
    return dialog.type === "book-metadata" ? (
      <MetadataDialogFields
        book={book}
        committedMetadata={book.sourceMetadata ?? {}}
        form={formStateFromMetadata(book.sourceMetadata)}
        onFieldChange={noop}
      />
    ) : (
      <CoverWritebackFields book={book} chooseImage={asyncNoop} changeFraming={noop} skeleton />
    );
  }
  if (dialog.type === "bulk-metadata") {
    const { common, values } = initialBulkMetadata(selectedBooks);
    return (
      <BulkMetadataFields
        common={common}
        values={values}
        enabled={{ series: false, publisher: false, language: false, subjects: false }}
        tagMode="replace"
        hasEnabledField={false}
        changedBookCount={0}
        toggleField={noop}
        setValues={noop}
        setTagMode={noop}
      />
    );
  }
  return null;
}
