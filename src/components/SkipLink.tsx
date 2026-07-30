import type { MouseEvent } from "react";

export const MAIN_CONTENT_ID = "archeion-main-content";
export const ARCHIVE_MANAGER_MAIN_CONTENT_ID = "archive-manager-main-content";

type SkipLinkProps = {
  targetId: string;
};

export function SkipLink({ targetId }: SkipLinkProps) {
  const focusTarget = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = event.currentTarget.ownerDocument.getElementById(targetId);
    if (!(target instanceof HTMLElement)) return;

    event.preventDefault();
    target.focus();
  };

  return (
    <a className="skip-link" href={`#${targetId}`} onClick={focusTarget}>
      Skip to content
    </a>
  );
}
