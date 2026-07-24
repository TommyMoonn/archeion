import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Folder, ReadonlyFolder, UpdateFolderInput } from "../../types/folder";
import { focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import {
  captureFolderMutationFocusContext,
  findFolderMutationFocusTarget,
  type FolderMutationFocusContext,
} from "../folders/folderMutationFocus";
import {
  predictFolderPathMutation,
  rewriteFolderPathForMutation,
  sameFolderPath,
  type FolderPathMutationMapping,
} from "./folderPathMutationContinuity";

type PendingFolderPathMutation = Readonly<{
  archiveId: string;
  focusContext: FolderMutationFocusContext | null;
  mapping: FolderPathMutationMapping;
  routeKey: string;
  routePath: string | null;
  status: "pending" | "completed";
  token: number;
}>;

export type RunFolderPathMutation = (
  folder: ReadonlyFolder,
  changes: UpdateFolderInput,
  operation: () => Promise<Folder | undefined>,
) => Promise<Folder | undefined>;

type UseFolderPathMutationContinuityInput = {
  activeArchiveId: string;
  folders: readonly ReadonlyFolder[] | undefined;
  searchParams: URLSearchParams;
  setSearchParams: (params: URLSearchParams, options?: Readonly<{ replace?: boolean }>) => void;
};

export function useFolderPathMutationContinuity({
  activeArchiveId,
  folders,
  searchParams,
  setSearchParams,
}: UseFolderPathMutationContinuityInput) {
  const mountedRef = useRef(true);
  const activeArchiveIdRef = useRef(activeArchiveId);
  const searchParamsRef = useRef(searchParams);
  const tokenRef = useRef(0);
  const focusContextRef = useRef<FolderMutationFocusContext | null>(null);
  const pendingRef = useRef<PendingFolderPathMutation | null>(null);
  const [pending, setPending] = useState<PendingFolderPathMutation | null>(null);
  const activePending = pending?.archiveId === activeArchiveId ? pending : null;

  const captureFocus = useCallback((folder: ReadonlyFolder) => {
    focusContextRef.current = captureFolderMutationFocusContext(document.activeElement, folder);
  }, []);

  const run = useCallback<RunFolderPathMutation>(
    async (folder, changes, operation) => {
      const mapping = predictFolderPathMutation(folder, changes, folders ?? []);
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      const focusContext = sameFolderPath(
        focusContextRef.current?.relativePath,
        mapping.oldRelativePath,
      )
        ? focusContextRef.current
        : null;
      const nextPending: PendingFolderPathMutation = {
        archiveId: activeArchiveId,
        focusContext,
        mapping,
        routeKey: searchParamsRef.current.toString(),
        routePath: null,
        status: "pending",
        token,
      };
      pendingRef.current = nextPending;
      setPending(nextPending);

      try {
        const updatedFolder = await operation();
        if (
          !mountedRef.current ||
          activeArchiveIdRef.current !== activeArchiveId ||
          pendingRef.current?.token !== token
        ) {
          return updatedFolder;
        }
        if (!updatedFolder?.relativePath) {
          throw new Error("The updated folder path is unavailable.");
        }

        const authoritativeMapping: FolderPathMutationMapping = {
          oldRelativePath: mapping.oldRelativePath,
          newRelativePath: updatedFolder.relativePath,
        };
        const currentParams = searchParamsRef.current;
        if (currentParams.toString() !== nextPending.routeKey) {
          pendingRef.current = null;
          focusContextRef.current = null;
          setPending(null);
          return updatedFolder;
        }
        const routePath =
          currentParams.get("view") === "folder"
            ? rewriteFolderPathForMutation(
                currentParams.get("folderPath") ?? undefined,
                authoritativeMapping,
              )
            : null;
        const completed: PendingFolderPathMutation = {
          ...nextPending,
          mapping: authoritativeMapping,
          routePath,
          status: "completed",
        };
        pendingRef.current = completed;
        setPending(completed);

        if (routePath) {
          const nextParams = new URLSearchParams(currentParams);
          nextParams.set("folderPath", routePath);
          setSearchParams(nextParams, { replace: true });
        }
        return updatedFolder;
      } catch (error) {
        if (pendingRef.current?.token === token) {
          pendingRef.current = null;
          setPending(null);
        }
        throw error;
      }
    },
    [activeArchiveId, folders, setSearchParams],
  );

  useEffect(() => {
    if (activePending?.status !== "completed") return;
    const resolvedPath = activePending.routePath ?? activePending.mapping.newRelativePath;
    const resolvedFolder = (folders ?? []).find((folder) =>
      sameFolderPath(folder.relativePath, resolvedPath),
    );
    if (
      !resolvedFolder ||
      (activePending.routePath &&
        !sameFolderPath(searchParams.get("folderPath") ?? undefined, activePending.routePath))
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingRef.current?.token !== activePending.token) return;
      if (activePending.focusContext) {
        focusElementIfRestorationOwned(
          findFolderMutationFocusTarget(
            document,
            activePending.mapping.newRelativePath,
            activePending.focusContext.surface,
          ),
          {
            requestIsCurrent: () => pendingRef.current?.token === activePending.token,
          },
        );
      }
      pendingRef.current = null;
      setPending((current) => (current?.token === activePending.token ? null : current));
      focusContextRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePending, folders, searchParams]);

  useLayoutEffect(() => {
    activeArchiveIdRef.current = activeArchiveId;
    searchParamsRef.current = searchParams;
  }, [activeArchiveId, searchParams]);

  useEffect(() => {
    pendingRef.current = null;
    focusContextRef.current = null;
  }, [activeArchiveId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = null;
      focusContextRef.current = null;
    };
  }, []);

  return {
    captureFocus,
    pendingMapping: activePending?.mapping ?? null,
    run,
  };
}
