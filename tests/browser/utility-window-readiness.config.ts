import { defineConfig } from "@playwright/test";
import base from "./ui-stability.config";

export default defineConfig({
  ...base,
  testMatch: ["utility-window-readiness.pw.ts", "utility-window-shells.pw.ts"],
  outputDir: "../../test-results/utility-window-readiness",
});
