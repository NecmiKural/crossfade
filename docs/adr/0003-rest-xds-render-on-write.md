# ADR-0003: REST xDS, render on write, time-based versions

- Status: accepted
- Date: 2026-10-11

## Context

Atlassian's Sovereign control plane renders Envoy config from templates plus "context" (data polled from other systems) and serves it over REST-JSON xDS; Envoy polls it. The video's later lesson (Sovereign 1.0) is to render when the data changes and serve precomputed bytes, so the request path stays trivial.

Envoy's REST subscription (`api_type: REST`) is still supported in v1.39.3. It polls `POST /v3/discovery:{clusters,routes}` every `refresh_delay`, sends the last accepted `version_info`, and accepts `304` as "unchanged". It never sends NACK details: a rejected update only shows up as a `version_info` that does not advance.

## Decision

- **Templates**: pure TypeScript functions in `lib/xds/render.ts`. **Context**: rows in Postgres.
- Every write (server action, CI API call, engine step, migration) runs `publishSnapshot` inside its own transaction, after its mutations: take `pg_advisory_xact_lock`, load the context, render, validate (`lib/xds/validate.ts`), hash each resource type with SHA-256, and insert a `snapshots` row only if a hash changed. A validation failure throws and rolls the whole change back.
- The JSON is stored as text and served verbatim.
- A changed type gets version `GREATEST(previous + 1, epoch_ms(clock_timestamp()))`; an unchanged type keeps its version. Versions only increase, even after a database restore, so "acked < served" comparisons stay meaningful.
- `migrate` publishes after every migration, so a renderer change reaches every app on deploy.

## Consequences

- Config reaches Envoy within `refresh_delay` plus jitter (2-4 s), not instantly. Fine for releases measured in seconds to hours.
- Clusters and routes are polled independently, so the engine gates traffic on Envoy reporting the candidate healthy (make-before-break), not on publish order.
- One global lock serializes snapshot writers. At this scale (a handful of writes per second at most) that is the simplest correct option.
- gRPC/ADS remains an upgrade path (a go-control-plane sidecar) if push or many Envoys are ever needed.
