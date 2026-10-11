import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["lib/core/**/*.ts", "lib/xds/**/*.ts", "lib/engine/**/*.ts"],
      exclude: ["**/*.test.ts", "lib/xds/publish.ts", "lib/engine/tick.ts"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["**/*.db.test.ts", "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/**/*.db.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
