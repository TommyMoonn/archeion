import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: [
    "busy-actions.pw.ts",
    "about-updates.pw.ts",
    "dialog-geometry.pw.ts",
    "library-confirmation-busy.pw.ts",
    "destructive-confirmations.pw.ts",
  ],
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/busy-actions",
  use: { ...base.use, baseURL: "http://127.0.0.1:4284" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/busy-actions-build.config.ts --host 127.0.0.1 --port 4284 --strictPort",
          url: "http://127.0.0.1:4284/tests/browser/fixtures/index.html",
          reuseExistingServer: false,
        },
});
