# ADR-0007: A Postgres work loop and one lock order

- Status: accepted
- Date: 2026-10-11

## Context

The video's broker put work on SQS, a worker wrote results to DynamoDB, and clients polled. Crossfade needs the same contract (CI creates a release, a worker moves it, CI polls) without adding a queue or another datastore. Several writers touch the same rows: the engine (every tick), people (pause, abort, approve), and CI (create).

## Decision

- **Postgres is the queue.** The engine claims due releases with `SELECT … FOR UPDATE SKIP LOCKED` (`status IN (warming, rolling, paused) AND next_check_at <= now()`), one short transaction per release. Envoy stats are fetched *before* any transaction, so no lock is ever held across an HTTP call.
- **People use plain `FOR UPDATE`** on the same row, so the engine skips a release while someone is editing it, and a person waits at most one short engine transaction.
- **One side-effect path.** `applyResult()` updates the release, appends events, changes the stable version on promotion, files incidents on rollback, and publishes a snapshot when weights change, for the engine and for people alike.
- **One lock order everywhere:** release row(s) → app row (`FOR NO KEY UPDATE`, which does not block foreign-key checks) → incidents → `pg_advisory_xact_lock(SNAPSHOT_LOCK)`. Creating a release first locks the app's active release (`FOR UPDATE`) before it touches the app row, so a create racing an engine promotion waits instead of deadlocking.
- **Keys are counters on the app row** (`release_seq`, `issue_seq`), incremented inside the creating transaction: gapless and serialized per app.

## Consequences

- No Redis, no queue service, no extra container; `docker compose up` stays small.
- Several engine replicas would be safe (SKIP LOCKED), though one is enough.
- A long transaction in a request handler would block the engine for that release; handlers keep transactions short and never call out while holding locks.
