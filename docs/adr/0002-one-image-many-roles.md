# ADR-0002: One golden image, several roles

- Status: accepted
- Date: 2026-10-11

## Context

The video's platform baked one immutable machine image (Packer + SaltStack) and ran it everywhere, with configuration and secrets injected at runtime. Crossfade needs a web tier (dashboard, REST xDS, CI API), a background worker for rollouts, and one-shot jobs (secret generation, migrations, demo seeding).

Running background loops or migrations inside the Next.js server (`instrumentation.ts`) ties them to the web server's lifecycle and to `next dev` reloads.

## Decision

Build one image (`node:24-alpine`, Next.js standalone output plus esbuild bundles in `dist/`) and run it in several compose roles:

| Role | Command | Lifetime |
|---|---|---|
| `init` | shell: write missing secrets into the `secrets` volume | one-shot, no network |
| `migrate` | `node dist/migrate.mjs` | one-shot |
| `web` | `node server.js` | long-running |
| `engine` | `node dist/engine.mjs` | long-running (added with the rollout engine) |

Compose orders them with `depends_on` conditions (`service_completed_successfully`, `service_healthy`). Secrets are files in a named volume, read through `*_FILE` variables, so nothing secret lives in the image, compose file or git.

## Consequences

- One build, one artifact to scan and pin; the roles cannot drift apart in versions.
- Workers must not import `next/*` or other web-only modules; an ESLint boundary enforces this.
- The stack needs no host bind mounts, so it also runs against a remote Docker host.
