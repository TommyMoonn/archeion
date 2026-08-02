import { createContext, useContext, useLayoutEffect, useRef } from "react";

export type ReaderSideSurfaceDismissHandler = () => boolean;
export type ReaderSideSurfaceDismissRegistration = (
  handler: ReaderSideSurfaceDismissHandler,
) => () => void;

export const ReaderSideSurfaceDismissContext =
  createContext<ReaderSideSurfaceDismissRegistration | null>(null);

export function useReaderSideSurfaceDismiss(
  handler: ReaderSideSurfaceDismissHandler,
  active = true,
): void {
  const register = useContext(ReaderSideSurfaceDismissContext);
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useLayoutEffect(() => {
    if (!active || !register) return;
    return register(() => handlerRef.current());
  }, [active, register]);
}
