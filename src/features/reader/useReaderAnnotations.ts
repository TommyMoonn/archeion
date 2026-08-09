import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { ReaderLocation } from "./readerLocation";
import { useReaderAnchorMaintenance } from "./useReaderAnchorMaintenance";
import { useReaderAnnotationCollection } from "./useReaderAnnotationCollection";
import { useReaderAnnotationMutations } from "./useReaderAnnotationMutations";
import { useReaderBookmarks } from "./useReaderBookmarks";

export type { ReaderAnnotationLoadStatus } from "./useReaderAnnotationCollection";
export type { ReaderAnnotationFeedback } from "./useReaderAnnotationMutations";

type UseReaderAnnotationsOptions = {
  activeArchiveId: string | null;
  bookId?: string;
  chapterHref?: string;
  chapterLabel?: string;
  location: ReaderLocation;
  readerReady: boolean;
  openingError: boolean;
  storage: LibraryStorage;
};

export function useReaderAnnotations({
  activeArchiveId,
  bookId,
  chapterHref,
  chapterLabel,
  location,
  readerReady,
  openingError,
  storage,
}: UseReaderAnnotationsOptions) {
  const drainAnchorMaintenanceRef = useRef<() => void>(() => undefined);
  const cancelQueuedAnchorUpdateRef = useRef<(annotationId: string) => void>(() => undefined);
  const collection = useReaderAnnotationCollection({ activeArchiveId, bookId, storage });
  const mutations = useReaderAnnotationMutations({
    drainAnchorMaintenanceRef,
    forget: collection.forget,
    isCurrentSession: collection.isCurrentSession,
    session: collection.session,
    storage,
    sync: collection.sync,
  });
  const anchorMaintenance = useReaderAnchorMaintenance({
    busyOwnerRef: mutations.busyOwnerRef,
    cancelQueuedAnchorUpdateRef,
    drainAnchorMaintenanceRef,
    isCurrentSession: collection.isCurrentSession,
    publishFeedback: mutations.publishFeedback,
    session: collection.session,
    update: mutations.update,
  });
  const bookmarks = useReaderBookmarks({
    annotations: collection.annotations,
    busy: mutations.busy,
    chapterHref,
    chapterLabel,
    location,
    mutations,
    openingError,
    readerReady,
    session: collection.session,
  });
  const loadFeedback = collection.loadFailed
    ? ({ kind: "error", message: "Annotations could not be loaded." } as const)
    : undefined;
  const feedback = loadFeedback ?? mutations.feedback;
  const clearMutationFeedback = mutations.clearFeedback;
  const clearLoadError = collection.clearLoadError;

  useLayoutEffect(() => {
    if (collection.loadStatus === "loading") return;
    clearMutationFeedback();
  }, [clearMutationFeedback, collection.loadStatus]);

  const clearFeedback = useCallback(() => {
    if (collection.loadFailed) clearLoadError();
    clearMutationFeedback();
  }, [clearLoadError, clearMutationFeedback, collection.loadFailed]);

  return useMemo(
    () => ({
      annotations: collection.annotations,
      bookmarks: bookmarks.bookmarks,
      busy: mutations.busy,
      canToggleCurrent: bookmarks.canToggleCurrent,
      claimNoteEditing: mutations.claimNoteEditing,
      clearFeedback,
      commands: {
        create: mutations.create,
        delete: mutations.delete,
        restore: mutations.restore,
        update: mutations.update,
      },
      currentBookmark: bookmarks.currentBookmark,
      detachedBookmarkAtCurrent: bookmarks.detachedBookmarkAtCurrent,
      feedback,
      loadStatus: collection.loadStatus,
      publishNoteRemoved: mutations.publishNoteRemoved,
      cancelQueuedAnchorUpdate: anchorMaintenance.cancelQueuedAnchorUpdate,
      queueAnchorUpdate: anchorMaintenance.queueAnchorUpdate,
      reload: collection.reload,
      resolveCurrentAnnotation: collection.resolveCurrentAnnotation,
      retireNoteRemoval: mutations.retireNoteRemoval,
      remove: mutations.remove,
      session: collection.session,
      toggleCurrent: bookmarks.toggleCurrent,
      toggleDisabledReason: bookmarks.toggleDisabledReason,
      undoRemove: mutations.undoRemove,
      updateLabel: bookmarks.updateLabel,
    }),
    [
      anchorMaintenance.cancelQueuedAnchorUpdate,
      anchorMaintenance.queueAnchorUpdate,
      bookmarks.bookmarks,
      bookmarks.canToggleCurrent,
      bookmarks.currentBookmark,
      bookmarks.detachedBookmarkAtCurrent,
      bookmarks.toggleCurrent,
      bookmarks.toggleDisabledReason,
      bookmarks.updateLabel,
      clearFeedback,
      mutations.claimNoteEditing,
      mutations.create,
      mutations.delete,
      collection.annotations,
      collection.loadStatus,
      collection.reload,
      collection.resolveCurrentAnnotation,
      feedback,
      mutations.busy,
      mutations.publishNoteRemoved,
      mutations.retireNoteRemoval,
      mutations.remove,
      mutations.restore,
      collection.session,
      mutations.undoRemove,
      mutations.update,
    ],
  );
}
