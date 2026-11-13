import { defineConfig } from "@playwright/test";
import base from "./sidebar-collapse.config";

export default defineConfig({
  ...base,
  testMatch: "book-details-panel.pw.ts",
  outputDir: "../../test-results/book-details-panel",
});
