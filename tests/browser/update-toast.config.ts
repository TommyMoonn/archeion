import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["update-toast.pw.ts", "update-toast-geometry.pw.ts"],
  workers: 1,
  outputDir: "../../test-results/update-toast",
  reporter: "list",
  use: { ...base.use, baseURL: "http://127.0.0.1:4281" },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/update-toast-build.config.ts --host 127.0.0.1 --port 4281 --strictPort",
          url: "http://127.0.0.1:4281/tests/browser/fixtures/index.html",
          reuseExistingServer: false,
        },
});
