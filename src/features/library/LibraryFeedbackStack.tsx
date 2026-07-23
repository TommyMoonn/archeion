import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

import { IconButton } from "../../components/IconButton";
import { usePausableAutoDismiss } from "../../components/usePausableAutoDismiss";
import { LIBRARY_FEEDBACK_AUTO_DISMISS_MS, type LibraryFeedbackToken } from "./libraryFeedback";

type LibraryFeedbackStackProps = {
  onDismiss: (id: string) => void;
  tokens: LibraryFeedbackToken[];
};

function feedbackIcon(tone: LibraryFeedbackToken["tone"]) {
  if (tone === "success") {
    return <CheckCircle aria-hidden="true" size={19} weight="regular" />;
  }

  if (tone === "error") {
    return <WarningCircle aria-hidden="true" size={19} weight="regular" />;
  }

  return <WarningCircle aria-hidden="true" size={19} weight="regular" />;
}

type LibraryFeedbackItemProps = {
  onDismiss: (id: string) => void;
  token: LibraryFeedbackToken;
};

function LibraryFeedbackItem({ onDismiss, token }: LibraryFeedbackItemProps) {
  const pauseHandlers = usePausableAutoDismiss<HTMLElement>({
    durationMs: token.autoDismissMs ?? LIBRARY_FEEDBACK_AUTO_DISMISS_MS,
    enabled: token.autoDismiss === true,
    onDismiss: () => onDismiss(token.id),
    resetKey: token,
  });

  return (
    <section
      aria-atomic="true"
      className="library-feedback__token status-token"
      data-has-detail={Boolean(token.detail || token.details?.length)}
      data-tone={token.tone}
      role={token.tone === "error" ? "alert" : "status"}
      {...pauseHandlers}
    >
      {feedbackIcon(token.tone)}
      <div className="library-feedback__copy">
        <p>{token.title}</p>
        {token.detail ? <span>{token.detail}</span> : null}
        {token.details?.length ? (
          <details>
            <summary>
              {token.details.length} {token.details.length === 1 ? "detail" : "details"}
            </summary>
            <ul>
              {token.details.map((detail, index) => (
                <li key={`${detail.label}-${index}`}>
                  <strong>{detail.label}</strong>
                  <span>{detail.message}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <IconButton
        className="library-feedback__dismiss"
        label="Dismiss feedback"
        onClick={() => onDismiss(token.id)}
      >
        <X aria-hidden="true" weight="bold" />
      </IconButton>
    </section>
  );
}

export function LibraryFeedbackStack({ onDismiss, tokens }: LibraryFeedbackStackProps) {
  if (tokens.length === 0) {
    return null;
  }

  return (
    <div aria-label="Library feedback" className="library-feedback" role="region">
      {tokens.map((token) => (
        <LibraryFeedbackItem key={token.id} onDismiss={onDismiss} token={token} />
      ))}
    </div>
  );
}
