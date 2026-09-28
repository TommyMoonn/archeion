import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results/browser",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4173 --strictPort",
    url: `${baseURL}/docs/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
