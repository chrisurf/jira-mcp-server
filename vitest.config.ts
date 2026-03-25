import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/types/**/*.ts",
        "src/server.ts",
        "src/jira/types.ts",
        "src/cache/types.ts",
      ],
      thresholds: {
        lines: 65,
        branches: 60,
        functions: 75,
      },
    },
  },
});
