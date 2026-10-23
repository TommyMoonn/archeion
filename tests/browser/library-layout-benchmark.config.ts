import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "library-layout-benchmark.benchmark.ts",
  outputDir: "../../test-results/library-layout-benchmark",
  reporter: "list",
  workers: 1,
  retries: 0,
  webServer: process.env.ARCHEION_UI_EXTERNAL_SERVER === "1" ? undefined : base.webServer,
});
