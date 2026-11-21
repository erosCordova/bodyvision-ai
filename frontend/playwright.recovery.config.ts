import { defineConfig } from "@playwright/test";
import { dirname, join, resolve } from "node:path";

if (process.env.APP_ENV !== "test" || process.env.CI !== "true" ||
    process.env.BODYVISION_RESTORE_DRILL !== "synthetic-only" ||
    !process.env.BODYVISION_RECOVERY_STATE) {
  throw new Error("Explicit disposable recovery browser mode required");
}

export default defineConfig({
  testDir: "./tests/recovery",
  testMatch: "restored-ui.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: [["./tests/recovery/safeReporter.ts"]],
  // Playwright error-context.md can include form values even with traces off.
  // Keep every artifact beside private state, outside the uploaded test-results.
  outputDir: join(dirname(resolve(process.env.BODYVISION_RECOVERY_STATE!)), "browser-results"),
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
