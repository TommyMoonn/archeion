import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "dialog-geometry.pw.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/dialog-geometry",
  use: { ...base.use, baseURL: "http://127.0.0.1:4282" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/dialog-geometry-build.config.ts --host 127.0.0.1 --port 4282 --strictPort",
          url: "http://127.0.0.1:4282/tests/browser/fixtures/dialog-geometry.html",
          reuseExistingServer: false,
        },
});
