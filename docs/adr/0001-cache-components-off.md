# ADR-0001: Cache Components off

- Status: accepted
- Date: 2026-10-11

## Context

`create-next-app` 16.4 enables Cache Components by default. With it on, any page that reads request-time data (the database, cookies) must wrap that read in `<Suspense>` or call `connection()`, otherwise the build tries to prerender it.

Every Crossfade page shows live data: release state, Envoy acks, error rates. The console refreshes every two seconds. Nothing on it is cacheable between requests.

## Decision

Scaffold with `--no-cache-components` and keep `cacheComponents` unset in `next.config.ts`. Console routes are explicitly dynamic (`export const dynamic = 'force-dynamic'`).

## Consequences

- No Suspense boundaries are needed just to satisfy the prerenderer.
- Route handlers (REST xDS, CI API) are unaffected: POST handlers are never cached.
- If a static, cacheable surface appears later (a public status page), revisit this decision for that route.
