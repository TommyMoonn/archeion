import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "sidebar-collapse.pw.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../test-results/sidebar-collapse",
  use: { ...base.use, baseURL: "http://127.0.0.1:4287" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/library-layout-build.config.ts --host 127.0.0.1 --port 4287 --strictPort",
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          url: "http://127.0.0.1:4287/tests/browser/fixtures/ui-stability.html",
          reuseExistingServer: false,
        },
});
