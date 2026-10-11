import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_" }],
    },
  },
  {
    // Everything the bundled workers (migrate, seed, engine) can reach must stay framework-free (ADR-0002).
    files: [
      "workers/**",
      "lib/core/**",
      "lib/db/**",
      "lib/xds/**",
      "lib/engine/**",
      "lib/releases/**",
      "lib/apps.ts",
      "lib/env.ts",
      "lib/events.ts",
      "lib/log.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "server-only", "better-auth/next-js"],
              message: "Worker-reachable modules must not depend on Next.js or React.",
            },
          ],
          paths: [
            { name: "@/lib/dal", message: "The DAL is web-only; pass an explicit actor instead." },
            { name: "@/lib/auth", message: "Auth is web-only; pass an explicit actor instead." },
            { name: "@/lib/auth-options", message: "Auth is web-only; pass an explicit actor instead." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
