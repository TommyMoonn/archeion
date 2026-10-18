import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// An external Vite process permits explicit server preparation before cold browser contexts.
// It never changes the production build or the shared suite's startup contract.
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "ui-stability.pw.ts",
  outputDir: "../../test-results/ui-stability",
  reporter: "line",
  workers: 1,
  webServer: process.env.ARCHEION_UI_EXTERNAL_SERVER === "1" ? undefined : base.webServer,
});
