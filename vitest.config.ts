import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://crossfade:crossfade-dev-only@127.0.0.1:5432/crossfade_test";

export default defineConfig({
  resolve: { alias: { "@": root, "server-only": `${root}tests/helpers/empty.ts` } },
  test: {
    coverage: {
      provider: "v8",
      include: ["lib/core/**/*.ts", "lib/xds/**/*.ts", "lib/engine/**/*.ts"],
      // Database glue is covered by the db suite and the compose e2e instead of this unit gate.
      exclude: ["**/*.test.ts", "lib/xds/publish.ts", "lib/xds/edge-store.ts", "lib/engine/tick.ts"],
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
          globalSetup: ["tests/global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl, TEST_DATABASE_URL: testDatabaseUrl },
          fileParallelism: false,
        },
      },
    ],
  },
});
