import { defineConfig } from "@playwright/test";
import base from "./ui-stability.config";

export default defineConfig({
  ...base,
  testMatch: "first-paint.pw.ts",
  outputDir: "../../test-results/first-paint",
});
