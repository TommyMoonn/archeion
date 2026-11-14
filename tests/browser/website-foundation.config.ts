import { defineConfig } from "@playwright/test";

const development = process.env.ARCHEION_WEBSITE_MODE === "dev";
const port = development ? 4191 : 4192;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "website-foundation.pw.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/website-foundation",
  use: { baseURL, browserName: "chromium" },
  webServer: {
    command: `pnpm --filter @archeion/website ${development ? "dev --no-open" : "serve --no-open"} --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/archeion/`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
