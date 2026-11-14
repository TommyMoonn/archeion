import { defineConfig } from "@playwright/test";
import base from "./ui-stability.config";

export default defineConfig({
  ...base,
  testMatch: "visual-refinement-diagnostics.pw.ts",
  outputDir: "../../test-results/visual-refinement-diagnostics",
});
