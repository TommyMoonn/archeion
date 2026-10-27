import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "modal-lifetime.pw.ts",
  testIgnore: [],
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../test-results/modal-lifetime",
  use: { ...base.use, baseURL: "http://127.0.0.1:4286" },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --config tests/browser/modal-lifetime-build.config.ts --host 127.0.0.1 --port 4286 --strictPort",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://127.0.0.1:4286/tests/browser/fixtures/modal-lifetime.html",
    reuseExistingServer: false,
  },
});
