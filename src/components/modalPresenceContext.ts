import { createContext } from "react";

export const SurfacePresenceContext = createContext<{
  present: boolean;
  complete: () => void;
  register: () => () => void;
} | null>(null);
