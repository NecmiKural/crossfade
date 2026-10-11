# ADR-0005: Sticky traffic split by default

- Status: accepted
- Date: 2026-10-11

## Context

During a canary, two versions answer at once. With a per-request random split, a single page load can fetch HTML from v2 and its hashed assets from v1, which do not exist there: the user gets a broken page, and the 5xx gate never notices because the failures are 404s. Vercel ships "skew protection" for the same reason.

Envoy can make a weighted split deterministic: `WeightedCluster.use_hash_policy` picks the cluster from the route's `hash_policy`. It will not create a cookie during weighted selection, so cookie-based stickiness only works with a cookie the app already sets.

## Decision

- Apps are sticky by default (`apps.sticky = true`).
- The hash input is the **leftmost** `X-Forwarded-For` entry (`regex_rewrite` `^\s*([^,\s]+).*$` → `\1`). With `use_remote_address`, Envoy appends the peer address before route resolution, so a hash input always exists; using only the leftmost entry keeps users pinned when CDN or proxy hops change.
- `sticky = false` renders a per-request random split.
- The tester route (`x-crossfade-tester: <token>`) exists only before the canary starts (pending approval, warming), so tester traffic never enters the canary counters.

## Consequences

- One browser stays on one version for the whole rollout; the demo traffic generator varies `X-Forwarded-For`, so the split is still visible in aggregate.
- Clients choose their own `X-Forwarded-For` when Envoy is exposed directly, so stickiness is a UX guarantee, not a security boundary, and a client can choose its bucket. SECURITY.md lists this.
- Behind a single NAT, all users share one bucket; the behind-proxy bootstrap (`xff_num_trusted_hops: 1`) restores per-client hashing when a proxy sets `X-Forwarded-For`.
