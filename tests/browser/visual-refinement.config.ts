import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: [
    "visual-refinement.pw.ts",
    "ui-stability.pw.ts",
    "visual-refinement-diagnostics.pw.ts",
  ],
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/visual-refinement",
  use: { ...base.use, baseURL: "http://127.0.0.1:4291" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/visual-refinement-build.config.ts --host 127.0.0.1 --port 4291 --strictPort",
          url: "http://127.0.0.1:4291/tests/browser/fixtures/visual-refinement.html",
          reuseExistingServer: false,
        },
});
