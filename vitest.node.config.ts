import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    restoreMocks: true,
    fileParallelism: false,
    setupFiles: ["tests/setup/node.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/api/**/*.test.ts",
      "tests/electron/**/*.test.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/node",
      include: [
        "server/**/*.ts",
        "shared/**/*.ts",
        "electron/security-policy.ts",
        "src/color-contrast.ts",
        "src/heatmap.ts",
        "src/itemOrder.ts",
        "src/questionFilters.ts",
        "src/questionReorder.ts",
        "src/review-history.ts",
        "src/wheelScroll.ts"
      ],
      exclude: [
        "**/*.d.ts",
        "server/latex.ts",
        "server/storage.ts",
        "shared/types.ts",
        "shared/validation.ts"
      ],
      thresholds: {
        statements: 75,
        lines: 75,
        functions: 75,
        branches: 65
      }
    }
  }
});
