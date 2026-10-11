// Bundles the non-Next entrypoints into self-contained ESM files that run from the golden image.
import { build } from "esbuild";

const entryPoints = ["workers/migrate.ts", "workers/seed.ts", "workers/engine.ts"];

await build({
  entryPoints,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
