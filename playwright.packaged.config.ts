import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/packaged",
  timeout: 90_000,
  workers: 1,
  reporter: "line",
  outputDir: "test-results/packaged",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" }
});
