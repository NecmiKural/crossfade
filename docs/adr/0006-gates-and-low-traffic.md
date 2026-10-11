# ADR-0006: Three gates, and honesty about low traffic

- Status: accepted
- Date: 2026-10-11

## Context

The video names two failure modes: a proxy receiving bad config, and "configuration that's valid, but that destroys the traffic". A health check only proves a container started; a version can pass `/healthz` and still fail a third of real requests. Envoy already counts per-cluster requests, 5xx responses and healthy hosts, so the edge itself can judge a release without Prometheus or an app SDK.

REST xDS adds two subtleties: clusters and routes are polled independently, and a rejected update is only visible as a `version_info` that does not advance.

## Decision

`decide()` (lib/engine/decide.ts) is a pure state machine with three gates:

1. **Health gate (warming).** The candidate gets 0% until Envoy reports `membership_healthy >= 1` for its cluster. This is also make-before-break: no route ever points at a cluster Envoy has not loaded. A candidate that never appears is *cancelled*; one that never turns healthy is *rolled back*.
2. **Convergence gate (applying).** A step's bake starts only when every live Envoy node acked the RDS version that carries the step's weights. Without an ack after 20 s the release holds as `suspected_nack`, labelled as an inference in the UI and API.
3. **Error budget (live).** Over the step's window, `errors / n` of the candidate cluster (`upstream_rq_5xx` / `upstream_rq_completed`, deltas from a baseline) must stay at or below the plan's `maxErrorRate`. A breach with `n >= minRequests` rolls back, even while paused. A candidate that turns unhealthy mid-rollout also rolls back, unless Envoy restarted in the last 30 s.

The baseline is re-captured at each step, on resume, and when Envoy's uptime shows it restarted (its counters reset).

## Low traffic

With few requests, an error rate is noise. The engine never judges below `minRequests`: when the bake time passes without enough data, the release **holds** with `insufficient_data {n, minRequests}` and says so in the UI, API and runbook, instead of silently passing. Manual plans let a person decide.

## Consequences

- The edge only sees what the edge sees: 5xx, resets, timeouts, no-healthy-upstream. Broken client-side code, wrong data, 4xx and latency regressions pass the gate. A latency gate and stable-relative thresholds are later work.
- Rollback speed is bounded by the poll interval (2-4 s) plus the tick (2 s) plus the time to collect `minRequests`.
