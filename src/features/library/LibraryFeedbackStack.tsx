import { Alert } from "../../components/ui/alert";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import { statusToneTextClass } from "../../components/statusStyles";
import { CircleCheck, CircleAlert, X } from "lucide-react";

import { IconButton } from "../../components/IconButton";
import { usePausableAutoDismiss } from "../../components/usePausableAutoDismiss";
import { LIBRARY_FEEDBACK_AUTO_DISMISS_MS, type LibraryFeedbackToken } from "./libraryFeedback";

type LibraryFeedbackStackProps = {
  onDismiss: (id: string) => void;
  tokens: LibraryFeedbackToken[];
};

function feedbackIcon(tone: LibraryFeedbackToken["tone"]) {
  if (tone === "success") {
    return <CircleCheck aria-hidden="true" className="size-feedback-glyph" />;
  }

  if (tone === "error") {
    return <CircleAlert aria-hidden="true" className="size-feedback-glyph" />;
  }

  return <CircleAlert aria-hidden="true" className="size-feedback-glyph" />;
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
    <Alert
      aria-atomic="true"
      className="library-feedback__token static grid feedback-token-columns items-center gap-button-compact py-integrity-row-block pe-integrity-row-block ps-integrity-row-inline border-standard border-solid border-line rounded-control text-text bg-feedback-card shadow-app-popover pointer-events-auto data-[has-detail=true]:items-start motion-safe:app-motion:animate-notice-enter"
      data-has-detail={Boolean(token.detail || token.details?.length)}
      data-tone={token.tone}
      role={token.tone === "error" ? "alert" : "status"}
      {...pauseHandlers}
    >
      {feedbackIcon(token.tone)}
      <div className="library-feedback__copy grid gap-integrity-copy-gap min-w-0">
        <p
          className={`m-0 text-body-only font-semibold leading-settings-status ${statusToneTextClass[token.tone]}`}
        >
          {token.title}
        </p>
        {token.detail ? (
          <span className="text-muted text-meta-only leading-collection-copy wrap-anywhere">
            {token.detail}
          </span>
        ) : null}
        {token.details?.length ? (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-folder-action-gap mt-field-label p-0 border-0 bg-transparent text-start text-muted text-meta-only cursor-pointer">
              <span aria-hidden="true" className="group-aria-expanded:hidden">
                ▸
              </span>
              <span aria-hidden="true" className="hidden group-aria-expanded:inline">
                ▾
              </span>
              {token.details.length} {token.details.length === 1 ? "detail" : "details"}
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <ul className="grid gap-folder-action-gap max-h-feedback-details-height mt-field-label mb-0 mx-0 p-0 overflow-auto text-muted text-meta-only leading-collection-copy list-none">
                {token.details.map((detail, index) => (
                  <li className="grid grid-cols-1 gap-px" key={`${detail.label}-${index}`}>
                    <strong className="wrap-anywhere text-text font-semibold">
                      {detail.label}
                    </strong>
                    <span className="wrap-anywhere">{detail.message}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
      <IconButton
        className="library-feedback__dismiss self-start size-feedback-dismiss cursor-pointer"
        label="Dismiss feedback"
        onClick={() => onDismiss(token.id)}
      >
        <X aria-hidden="true" />
      </IconButton>
    </Alert>
  );
}

export function LibraryFeedbackStack({ onDismiss, tokens }: LibraryFeedbackStackProps) {
  if (tokens.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Library feedback"
      className="library-feedback box-border fixed z-12 top-feedback-top end-feedback-end grid gap-input-gap w-feedback-width max-h-feedback-height p-control-inset overflow-y-auto overscroll-contain pointer-events-auto [@media(max-width:720px)]:top-feedback-top-narrow [@media(max-width:720px)]:inset-x-overlay-viewport-inset [@media(max-width:720px)]:w-auto [@media(max-width:720px)]:max-h-feedback-height-narrow in-[.app-shell:has([data-update-notice])]:max-h-update-feedback-height!"
      role="region"
    >
      {tokens.map((token) => (
        <LibraryFeedbackItem key={token.id} onDismiss={onDismiss} token={token} />
      ))}
    </div>
  );
}
