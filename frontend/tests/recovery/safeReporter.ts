import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

// Never serialize errors, call logs, assertions or attachments: they can carry
// credentials typed into a form. Only explicit, static test.step labels escape.
export default class SafeReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    if (result.status !== "passed") {
      const kind = result.error?.message?.includes("browserType.launch")
        ? "browser_start" : result.error?.message?.includes("strict mode violation")
          ? "ambiguous_locator" : result.status === "timedOut" ? "timeout" : "assertion";
      const location = result.error?.stack?.match(/restored-ui\.spec\.ts:(\d+):\d+/);
      process.stdout.write(JSON.stringify({ event: "synthetic_recovery_browser_test_failed",
        kind, source_line: location ? Number(location[1]) : null }) + "\n");
    }
  }
  onError() {
    process.stdout.write('{"event":"synthetic_recovery_browser_runner_failed"}\n');
  }
  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.error && step.category === "test.step") {
      process.stdout.write(JSON.stringify({ event: "synthetic_recovery_browser_step_failed",
        step: step.title }) + "\n");
    }
  }
  onEnd(result: FullResult) {
    process.stdout.write(JSON.stringify({ event: "synthetic_recovered_browser_completed",
      status: result.status }) + "\n");
  }
}
