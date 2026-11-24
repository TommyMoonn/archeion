import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "./ui-stability.config";

const baseURL = "http://127.0.0.1:4292";

export default defineConfig({
  ...base,
  testMatch: "utility-window-shells.pw.ts",
  outputDir: "../../test-results/utility-window-readiness",
  use: { ...base.use, baseURL },
  webServer:
    process.env.ARCHEION_UI_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          command:
            "node node_modules/vite/bin/vite.js preview --config tests/browser/utility-window-readiness-build.config.ts --host 127.0.0.1 --port 4292 --strictPort",
          url: `${baseURL}/tests/browser/fixtures/ui-stability.html`,
          reuseExistingServer: false,
        },
});
