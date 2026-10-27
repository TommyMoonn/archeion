import { createContext, type ReactNode } from "react";

export type DialogShellOptions = {
  closeOnBackdropClick?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
};

export type DialogShellOwner = {
  descriptionId: string;
  titleId: string;
  register: (options: DialogShellOptions) => void;
  retainFocus: () => void;
  reset: () => void;
  renderError: (retry: () => void) => ReactNode;
  loading: () => void;
};

export const DialogShellContext = createContext<DialogShellOwner | null>(null);
