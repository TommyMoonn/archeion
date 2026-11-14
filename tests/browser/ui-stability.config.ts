import { defineConfig } from "@playwright/test";
import base from "./visual-refinement.config";

// Observe the built fixture so development module transforms do not dominate
// cold browser measurements. The package command prepares the existing build.
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "ui-stability.pw.ts",
  testIgnore: [],
  fullyParallel: false,
  outputDir: "../../test-results/ui-stability",
  reporter: "line",
  workers: 1,
  webServer: process.env.ARCHEION_UI_EXTERNAL_SERVER === "1" ? undefined : base.webServer,
});
