import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "async-surfaces.pw.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/async-surfaces",
  use: { ...base.use, baseURL: "http://127.0.0.1:4285" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/async-surfaces-build.config.ts --host 127.0.0.1 --port 4285 --strictPort",
          url: "http://127.0.0.1:4285/tests/browser/fixtures/async-surfaces.html",
          reuseExistingServer: false,
        },
});
