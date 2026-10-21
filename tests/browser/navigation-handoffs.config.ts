import { defineConfig } from "@playwright/test";
import base from "./ui-stability.config";

export default defineConfig({
  ...base,
  testMatch: "navigation-handoffs.pw.ts",
  outputDir: "../../test-results/navigation-handoffs",
});
