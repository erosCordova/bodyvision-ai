import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/privacy-e2e", workers: 1, fullyParallel: false,
  retries: 0, timeout: 120000, reporter: "list", outputDir: "test-results/privacy",
  use: {
    baseURL: "http://127.0.0.1:5176", trace: "off", video: "off", screenshot: "off",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
