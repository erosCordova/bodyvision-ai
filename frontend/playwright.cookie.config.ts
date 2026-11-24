import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/cookie-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "list",
  outputDir: "test-results/cookie",
  use: {
    baseURL: "http://127.0.0.1:5175",
    // Never persist authenticated network traces or access tokens.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
});
