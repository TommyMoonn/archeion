import {
  ArrowRight,
  BookOpen,
  FolderOpen,
  Heart,
  Info,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";

import type { ContextMenuAction } from "../../components/ContextMenu";
import type { Book } from "../../types/book";

type BookContextActionOptions = {
  book: Book;
  canDelete: boolean;
  canManageFile: boolean;
  onDelete: (book: Book) => void;
  onEditMetadata: (book: Book) => void;
  onMove?: (book: Book) => void;
  onRead: (book: Book) => void;
  onRenameFile?: (book: Book) => void;
  onRevealFile?: (book: Book) => void;
  onToggleFavorite: (book: Book) => void;
  showRenameFileAction: boolean;
};

export function createBookContextActions({
  book,
  canDelete,
  canManageFile,
  onDelete,
  onEditMetadata,
  onMove,
  onRead,
  onRenameFile,
  onRevealFile,
  onToggleFavorite,
  showRenameFileAction,
}: BookContextActionOptions): ContextMenuAction[] {
  const showFileActions = canManageFile && !book.isFileMissing;
  const actions: ContextMenuAction[] = [
    {
      disabled: Boolean(book.isFileMissing),
      disabledReason: book.isFileMissing ? "The EPUB file is missing." : undefined,
      icon: <BookOpen weight="regular" />,
      id: "read",
      label: "Read",
      onSelect: () => onRead(book),
    },
    {
      icon: <Heart weight={book.isFavorite ? "fill" : "regular"} />,
      id: "favorite",
      label: book.isFavorite ? "Remove favorite" : "Add favorite",
      onSelect: () => onToggleFavorite(book),
    },
    {
      icon: <Info weight="regular" />,
      id: "edit-metadata",
      label: "Edit metadata",
      onSelect: () => onEditMetadata(book),
    },
  ];

  if (showRenameFileAction && showFileActions && onRenameFile) {
    actions.push({
      icon: <PencilSimple weight="regular" />,
      id: "rename-file",
      label: "Rename file",
      onSelect: () => onRenameFile(book),
    });
  }

  if (showFileActions && onMove) {
    actions.push({
      icon: <ArrowRight weight="regular" />,
      id: "move",
      label: "Move to folder",
      onSelect: () => onMove(book),
    });
  }

  if (showFileActions && onRevealFile) {
    actions.push({
      icon: <FolderOpen weight="regular" />,
      id: "reveal",
      label: "Reveal in folder",
      onSelect: () => onRevealFile(book),
    });
  }

  if (canDelete) {
    actions.push({
      className: "book-menu__danger",
      danger: true,
      icon: <Trash weight="regular" />,
      id: "delete",
      label: book.isFileMissing ? "Remove metadata" : "Delete EPUB",
      onSelect: () => onDelete(book),
    });
  }

  return actions;
}
