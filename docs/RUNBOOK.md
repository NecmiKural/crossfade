# Crossfade runbook

What to check, what each failure looks like, and how to rotate secrets, back up and recover. Every command runs from the directory that holds `compose.yaml`. Add `--profile demo` to `docker compose` commands if you run the demo apps.

## Health at a glance

| Check | Healthy |
|---|---|
| `curl -s 127.0.0.1:3000/api/health` | `{"db":"ok","engine":{"lastTickSecondsAgo":0}}`. The engine ticks every 2 s, so anything above 10 means it is stuck or down. A 503 means the database is unreachable. |
| Console top bar | `ENGINE ticking` and `EDGE edge-1` both lit green. |
| Console **Edge** page | Each node is `live`, with CDS and RDS acked at the served version. |
| `docker compose ps` | `db`, `web`, `engine` and `envoy` are running (healthy where a check exists). `init` and `migrate` have exited with 0. |
| `docker compose logs -f engine` | One JSON line per state change, for example `step live`, `rolled back`. |

**Start order.**
- `docker compose up -d --wait` already starts the services in the safe order: `init` → `db` → `migrate` → `web` and `engine` → `envoy`, which waits until `web` is healthy.
- If you restart services by hand, start `envoy` last (see [Envoy cold start](#envoy-restarted-while-the-control-plane-was-down)).

## Failure modes

### The control plane (`web`) is down

**What you see**
- The console and the CI API do not answer.
- The edge keeps serving: Envoy holds on to its last good config, so the split stays where it was.
- Envoy's `cluster_manager.cds.update_failure` and `http.edge.rds.edge.update_failure` counters rise with every failed poll.

**What to do**
1. Check `docker compose logs web`.
2. Run `docker compose up -d --wait web`.

In-flight releases cannot advance while `web` is down. Without `web`, Envoy cannot fetch new routes, so the engine holds them with `no Envoy node is polling`.

### The database is down

**What you see**
- `/api/health` returns 503.
- The console shows errors.
- The engine logs failed ticks.
- Envoy keeps serving its last config.

**What to do**
1. Check `docker compose logs db`.
2. Make sure the disk is not full.
3. Run `docker compose up -d --wait db`, and `web` and `engine` reconnect on their own.

### The engine is down

**What you see**
- `lastTickSecondsAgo` grows, and the ENGINE lamp goes out.
- Releases freeze where they are. **Nothing judges an in-flight release while the engine is down**, so a bad candidate keeps its share of traffic.

**What to do**
- If a candidate is misbehaving, **abort it from the console**. Abort runs in `web` and publishes the stable-only routes without the engine.
- Then check `docker compose logs engine` and run `docker compose up -d --wait engine`.

### Envoy restarted while the control plane was down

**What you see.** Every request to the edge returns a 404 with an empty body (flag `NR` in the access log). Envoy keeps its config only in memory. After a restart, it waits up to 15 s for the control plane, then starts with no routes.

**What to do.** Bring the database and `web` back first. Envoy fetches the config on its next poll, within 2 s. Never restart Envoy to fix a control-plane problem.

### The edge returns 404 for one app only

**What you see.** One app returns 404 while the others work.

**Cause and fix.**
- **Wrong domain.** The body reads `crossfade: no app for this host`: the request's `Host` matches no app's domain. Envoy ignores the port in `Host`.
- **Wrong path.** The body is empty: the domain matched, but the path is outside the app's prefix.

Check the app's domain and prefix on the **Apps** page.

### The edge returns 503

**What you see.** Envoy answers `no healthy upstream`, or the 503 shows in its access log with the flag `UH`.

**Cause and fix.**
- **Every endpoint of the cluster failed its health check.** Check that the containers are running on the `crossfade_apps` network, and that the health path returns 200.
- **Connection resets (`UC`).** The upstream closed a keep-alive connection that Envoy reused. Upstream keep-alive must stay above 4 seconds.

## Release holds

A held release shows the reason on its page, in the timeline and in `GET /api/v1/releases/:id` (`hold`). The engine retries every tick. You can always **abort**: it sends all traffic back to stable and files no incident.

| Hold | Meaning | What to do |
|---|---|---|
| `Envoy stats unavailable` | The engine could not read `envoy:9902/stats` within 1 s. It never advances blind. | Check that `envoy` is running and `docker compose logs engine`. |
| `candidate cluster not at the edge yet` | Envoy has not loaded the candidate's cluster. | Wait a few seconds. After the warm-up time (60 s for `demo`, 5 min otherwise) the release is cancelled. |
| `candidate not healthy yet` | The cluster is loaded, but no endpoint passed the health check. | Check the container and its health path. After the warm-up time the release rolls back and files an incident. |
| `Envoy restarted moments ago` | `server.uptime` went backwards, so the counters reset. | Nothing. The engine takes a new baseline and the bake starts again. |
| `no Envoy node is polling` | No node has polled the routes in the last 15 s. | Check `envoy` and `web` (see above). |
| `Envoy has not applied the step (suspected NACK…)` | Envoy is polling, but has not acked the new routes for 20 s. This is inferred from `version_info`: Envoy advances it only after it accepts an update. | Run `docker compose logs envoy \| grep -i rejected`. Snapshots are validated before they are stored, so a rejection is a bug. Abort the release and [open an issue](https://github.com/NecmiKural/crossfade/issues) with the log line. |
| `paused` | Someone paused it. The error budget still applies. | Resume it, or abort it. |
| `not enough requests to judge` | The bake ended with fewer candidate requests than the plan's minimum. | Wait for traffic. After the plan's wait (2 min for `demo`, up to 1 h for `cautious`) the release is cancelled. Use the `manual` plan for quiet apps. |
| `waiting for a person to advance` | `manual` plan: the step baked cleanly. | Advance, promote or abort. |
| `the engine failed to process this release` | The release's tick threw an error. Other releases keep moving. | See `docker compose logs engine` for the error, then abort if it repeats. |

## Rotating secrets

The `init` service writes any secret file that is missing from the `secrets` volume and leaves existing ones alone. So to rotate a secret, delete its file and run `init` again:

```sh
docker compose run --rm --no-deps init sh -c 'rm /run/crossfade/<name>'
docker compose run --rm --no-deps init
```

Then restart only what reads that secret:

| Secret (`<name>`) | Then run | Effect |
|---|---|---|
| `xds_token` (Envoy ↔ control plane, and the stats listener) | `docker compose restart engine envoy` | Until Envoy restarts, its polls get 401 and it keeps serving the last config. The restart drops open edge connections. Do it outside a release. `web` reads the token on every request, so it needs no restart. |
| `auth_secret` (session signing) | `docker compose restart web` | Everyone is signed out. API keys keep working. |
| `pg_password` (database) | See below | |
| `setup_token` | Nothing | It only matters until the first account exists. After that, `/api/setup` refuses with 403 `setup_complete` even with the right token. |

**Database password.** Rotating it takes one more step, because Postgres reads `POSTGRES_PASSWORD_FILE` only when it creates the database. After you delete and regenerate `pg_password`, set the new value on the role. The value is read from the file inside the container, so it never appears in a command line:

```sh
docker compose exec -T db psql -U crossfade -d crossfade -v ON_ERROR_STOP=1 <<'SQL'
\set pw `cat /run/crossfade/pg_password`
ALTER ROLE crossfade PASSWORD :'pw';
SQL
docker compose restart web engine
```

**Tester tokens.** On the **Apps** page, open the app and click **Rotate**. Envoy picks up the new token on its next poll. Revealing a token is admin-only and recorded in the audit trail.

**API keys.** Under **Settings**:
1. Create a new key with the same app scope. It is shown once.
2. Update the CI secret.
3. Revoke the old key. A revoked key stops working on its next request.

## Locked out of the owner account

If another admin can sign in, they can add a new admin account for you under **Settings**.

If nobody can, reset the password from the host:

1. **Hash a new password** (at least 12 characters) inside the `web` container. The password is read from stdin, so it does not show up in `ps` or the shell history:

   ```sh
   read -rs NEW_PASSWORD
   printf '%s' "$NEW_PASSWORD" | docker compose exec -T web node -e '
   const { randomBytes, scryptSync } = require("node:crypto");
   const password = require("node:fs").readFileSync(0, "utf8").normalize("NFKC");
   const salt = randomBytes(16).toString("hex");
   const key = scryptSync(password, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 });
   process.stdout.write(`${salt}:${key.toString("hex")}`);
   ' > new-password.hash
   unset NEW_PASSWORD
   ```

   This is the same scrypt format Better Auth uses.

2. **Store it.** This also makes the account an admin, unbans it, and ends its sessions:

   ```sh
   docker compose exec -T db psql -U crossfade -d crossfade -v ON_ERROR_STOP=1 \
     -v email=owner@example.com -v hash="$(cat new-password.hash)" <<'SQL'
   BEGIN;
   UPDATE "user" SET role = 'admin', banned = false WHERE email = :'email';
   UPDATE account SET password = :'hash' WHERE provider_id = 'credential' AND user_id = (SELECT id FROM "user" WHERE email = :'email');
   DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = :'email');
   COMMIT;
   SQL
   rm new-password.hash
   ```

3. **Sign in** with the new password.

## Backup and restore

You need **both** of these:
- **The database**, which holds the apps, versions, releases, incidents, audit trail, accounts and keys.
- **The `secrets` volume.** Without the matching `pg_password` you cannot connect to a restored data volume, and a new `auth_secret` signs everyone out.

**Back up:**

```sh
docker compose exec -T db pg_dump -U crossfade -d crossfade -Fc > crossfade.dump
docker compose run --rm --no-deps -T init sh -c 'tar -C /run/crossfade -czf - .' > crossfade-secrets.tgz
```

Keep `crossfade-secrets.tgz` somewhere private. It holds every credential of the installation.

**Restore the database** into a running installation:

```sh
docker compose stop web engine
docker compose exec -T db pg_restore -U crossfade -d crossfade --clean --if-exists --single-transaction < crossfade.dump
docker compose run --rm migrate      # applies newer migrations and re-publishes the Envoy config
docker compose start web engine
```

Snapshot versions only ever increase, even after restoring an older dump. So Envoy always sees the re-published config as new and applies it.

**Restore the secrets** onto a fresh host, before the first `up`:

```sh
docker compose run --rm --no-deps -T init sh -c 'tar -C /run/crossfade -xzf -' < crossfade-secrets.tgz
```

## Upgrading Crossfade

```sh
git pull
docker compose up -d --build --wait
```

1. `migrate` runs first, while the old `web` and `engine` are still serving.
2. The new `web` and `engine` then replace them. Envoy keeps serving its config throughout, and starts only after `web` is healthy if it is recreated.
3. In-flight releases carry on from their database state when the new engine starts.

Read the release notes before you jump several versions.

## Writing schema changes

Because `migrate` runs while the previous `web` and `engine` are still up, every migration must work with the code of the release before it. Split breaking changes over two releases, expand first and contract later:

1. **Expand.** Add new tables and nullable columns, or columns with defaults. Write to both the old and the new shape.
2. **Backfill**, in a migration or in the code.
3. **Contract** in the next release: add `NOT NULL`, and drop the old columns once no running code reads them.

Generate migrations with `npm run db:generate` and commit the SQL under `drizzle/`. `migrate` re-publishes the Envoy config after every run. So when a migration changes what the renderer reads, the new config reaches Envoy on the next poll.
