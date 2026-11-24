import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/private-e2e",
  fullyParallel: false,
  // These browser flows share administrator fixtures and one tenant audit head.
  // Keep them sequential; PostgreSQL concurrency is tested in backend integration.
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "list",
  outputDir: "test-results/private",
  use: {
    baseURL: "http://127.0.0.1:5174",
    // Authenticated network traces contain bearer tokens. Persist only images.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
});
