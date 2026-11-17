import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const development = process.env.ARCHEION_WEBSITE_MODE === "dev";
const port = development ? 4191 : 4192;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: [
    "website-static.pw.ts",
    "landing-download.pw.ts",
    "landing-navigation.pw.ts",
    "landing-hero.pw.ts",
    "landing-local-first.pw.ts",
    "landing-product-story.pw.ts",
    "landing-visual-system.pw.ts",
    "website-docs-shell.pw.ts",
    "website-docs-interactions.pw.ts",
    "website-docs-accessibility.pw.ts",
    "website-docs-articles.pw.ts",
    "website-docs-font-preferences.pw.ts",
    "website-docs-search.pw.ts",
    "website-docs-search-interaction.pw.ts",
    "website-docs-copy.pw.ts",
    "website-docs-overview.pw.ts",
    "website-docs-changelog.pw.ts",
  ],
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../../playwright-report/website" }],
  ],
  outputDir: "../../test-results/website-foundation",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure-and-retries",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: development
      ? `pnpm --filter @archeion/website dev --no-open --host 127.0.0.1 --port ${port}`
      : "pnpm --filter @archeion/website build && node tests/browser/serve-website-build.mjs",
    url: `${baseURL}/archeion/`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
