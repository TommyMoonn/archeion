import type { ComponentProps } from "react";

import {
  dialogFrameClass,
  dialogPanelClass,
  dialogCopyClass,
  dialogTitleClass,
  dialogFooterClass,
} from "../dialogStyles";

// Native counterpart to shadcn's dialog primitives: retain the desktop top layer,
// focus ownership and interruptible lifetime managed by the application.
export function DialogFrame({
  className,
  workspace = false,
  ...props
}: ComponentProps<"dialog"> & { workspace?: boolean }) {
  return (
    <dialog
      data-slot="dialog"
      aria-modal="true"
      className={[dialogFrameClass, workspace && "dialog--workspace", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function DialogContent(props: ComponentProps<"div">) {
  return <div data-slot="dialog-content" className={dialogPanelClass} {...props} />;
}

export function DialogHeader(props: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={dialogCopyClass} {...props} />;
}

export function DialogTitle(props: ComponentProps<"h2">) {
  return <h2 data-slot="dialog-title" className={dialogTitleClass} {...props} />;
}

export function DialogFooter(props: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={dialogFooterClass} {...props} />;
}
