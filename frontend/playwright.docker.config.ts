import { defineConfig } from "@playwright/test";

const stage = process.env.DOCKER_HANDOFF_STAGE ?? "before-restart";
if (!["before-restart", "after-restart"].includes(stage)) {
  throw new Error("DOCKER_HANDOFF_STAGE must be before-restart or after-restart");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: stage === "after-restart"
    ? ["**/operations/docker-restart.spec.ts"]
    : ["**/e2e/foundation.spec.ts", "**/e2e/data-core.spec.ts", "**/e2e/progress.spec.ts"],
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: `test-results/docker-${stage}`,
  use: {
    // This suite writes synthetic records only to the local Compose stack.
    baseURL: "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
