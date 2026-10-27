import { defineConfig } from "@playwright/test";

const port = Number(process.env.ARCHEION_BROWSER_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("ARCHEION_BROWSER_PORT must be an integer between 1024 and 65535");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  // Chunk interception requires the production fixture build, run separately in CI.
  testIgnore: "**/async-surfaces.pw.ts",
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
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/docs/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
