import { useCallback, useRef, useState } from "react";

import {
  type LibraryFeedbackDraft,
  type LibraryFeedbackToken,
  upsertLibraryFeedbackToken,
} from "./libraryFeedback";

export function useLibraryFeedback() {
  const sequenceRef = useRef(0);
  const [tokens, setTokens] = useState<LibraryFeedbackToken[]>([]);

  const dismiss = useCallback((id: string) => {
    setTokens((currentTokens) => currentTokens.filter((token) => token.id !== id));
  }, []);

  const push = useCallback((feedback: LibraryFeedbackDraft) => {
    const id = feedback.id ?? `library-feedback-${sequenceRef.current++}`;
    setTokens((currentTokens) => upsertLibraryFeedbackToken(currentTokens, { ...feedback, id }));
    return id;
  }, []);

  const showError = useCallback(
    (title: string, detail?: string) => {
      push({ id: "library-error", tone: "error", title, detail });
    },
    [push],
  );

  const showRescanSuccess = useCallback(() => {
    push({
      id: "manual-rescan",
      tone: "success",
      title: "Archive refreshed.",
      autoDismiss: true,
    });
  }, [push]);

  const showRescanError = useCallback(() => {
    push({
      id: "manual-rescan",
      tone: "error",
      title: "The archive could not be scanned.",
    });
  }, [push]);

  return {
    dismiss,
    push,
    showError,
    showRescanError,
    showRescanSuccess,
    tokens,
  };
}
