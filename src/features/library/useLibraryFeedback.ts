import { useCallback, useRef, useState } from "react";

import {
  type LibraryFeedbackDraft,
  type LibraryFeedbackToken,
  upsertLibraryFeedbackToken,
} from "./libraryFeedback";

export type LibraryFeedbackOperation = Readonly<{
  owner: string;
  revision: number;
}>;

export function useLibraryFeedback() {
  const sequenceRef = useRef(0);
  const operationRevisionsRef = useRef(new Map<string, number>());
  const [tokens, setTokens] = useState<LibraryFeedbackToken[]>([]);

  const dismiss = useCallback((id: string) => {
    setTokens((currentTokens) => currentTokens.filter((token) => token.id !== id));
  }, []);

  const push = useCallback((feedback: LibraryFeedbackDraft) => {
    const id = feedback.id ?? `library-feedback-${sequenceRef.current++}`;
    setTokens((currentTokens) => upsertLibraryFeedbackToken(currentTokens, { ...feedback, id }));
    return id;
  }, []);

  const beginOperation = useCallback((owner: string): LibraryFeedbackOperation => {
    const revision = (operationRevisionsRef.current.get(owner) ?? 0) + 1;
    operationRevisionsRef.current.set(owner, revision);
    return { owner, revision };
  }, []);

  const publishOperation = useCallback(
    (operation: LibraryFeedbackOperation, feedback: LibraryFeedbackDraft): boolean => {
      if (operationRevisionsRef.current.get(operation.owner) !== operation.revision) {
        return false;
      }
      push(feedback);
      return true;
    },
    [push],
  );

  const showError = useCallback(
    (title: string, detail?: string) => {
      const operation = beginOperation("library-error");
      publishOperation(operation, { id: "library-error", tone: "error", title, detail });
    },
    [beginOperation, publishOperation],
  );

  return {
    beginOperation,
    dismiss,
    publishOperation,
    push,
    showError,
    tokens,
  };
}
