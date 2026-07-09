import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect } from "react";

import { IconButton } from "../../components/IconButton";
import {
  LIBRARY_FEEDBACK_AUTO_DISMISS_MS,
  type LibraryFeedbackToken,
} from "./libraryFeedback";

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

  return <Info aria-hidden="true" size={19} weight="regular" />;
}

export function LibraryFeedbackStack({
  onDismiss,
  tokens,
}: LibraryFeedbackStackProps) {
  useEffect(() => {
    const timeoutIds = tokens
      .filter((token) => token.autoDismiss)
      .map((token) =>
        window.setTimeout(
          () => onDismiss(token.id),
          token.autoDismissMs ?? LIBRARY_FEEDBACK_AUTO_DISMISS_MS,
        ),
      );

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [onDismiss, tokens]);

  if (tokens.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Library feedback"
      className="library-feedback"
      role="region"
    >
      {tokens.map((token) => (
        <section
          aria-live={token.tone === "error" ? "assertive" : "polite"}
          className="library-feedback__token"
          data-has-detail={Boolean(token.detail || token.details?.length)}
          data-tone={token.tone}
          key={token.id}
          role={token.tone === "error" ? "alert" : "status"}
        >
          {feedbackIcon(token.tone)}
          <div className="library-feedback__copy">
            <p>{token.title}</p>
            {token.detail ? <span>{token.detail}</span> : null}
            {token.details?.length ? (
              <ul>
                {token.details.map((detail, index) => (
                  <li key={`${detail.label}-${index}`}>
                    <strong>{detail.label}</strong>
                    <span>{detail.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <IconButton
            className="library-feedback__dismiss"
            label="Dismiss feedback"
            onClick={() => onDismiss(token.id)}
          >
            <X aria-hidden="true" size={15} weight="bold" />
          </IconButton>
        </section>
      ))}
    </div>
  );
}
