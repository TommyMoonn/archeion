import { useEffect } from "react";

import { AutomaticUpdateRuntime } from "./automaticUpdateRuntime";

export function AppUpdateRuntime() {
  useEffect(() => new AutomaticUpdateRuntime().start(), []);
  return null;
}
