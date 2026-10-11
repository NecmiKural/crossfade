# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue. Only the latest release is supported.

Crossfade is a young project and has not had an independent audit. The threat model below describes what it is designed to withstand and where it stops.

## What Crossfade protects

| Asset | Why it matters |
|---|---|
| **Traffic routing** (which version serves which request) | Whoever controls the routes controls what users see. A bad route can send traffic anywhere Envoy can reach. |
| **The secrets volume** (`pg_password`, `xds_token`, `auth_secret`, `setup_token`) | It holds every credential of the installation. |
| **Accounts, sessions and API keys** | They grant the right to start, approve, promote and abort releases. |
| **Tester tokens** | One lets its holder reach a candidate before it is public. |
| **The audit trail** (`events`) | It records who did what, for incidents and reviews. |

## Trust boundaries

```
internet ──► Envoy :8080 (edge) ──► upstream containers        [apps network]
                 │  ▲
     xDS + token │  │ GET /stats + token (:9902, not published)  [control network]
                 ▼  │
operator ──► web :3000 (127.0.0.1) ◄── CI with an API key
                 │
              Postgres  ◄── engine                               [data network]
```

- **Clients on the internet** can reach only the edge listener on `:8080`. The edge has no route to the dashboard, the API or xDS.
- **Upstream containers** share the `apps` network with Envoy only. They cannot reach Postgres, `web` or `engine`.
- **Envoy** is trusted to report counters honestly. It authenticates to `web` with the xDS token.
- **Operators and CI** reach `web` on `127.0.0.1:3000`, through an SSH tunnel, a VPN or a self-hosted runner.

## Threats and mitigations

| Threat | Mitigation | Where |
|---|---|---|
| **Pointing an app at an arbitrary host** to reach internal services, cloud metadata or another app's upstream | Upstreams are deny-by-default and allowlisted per app by the operator. Hosts must start with a letter, which rules out IP literals in every encoding. `localhost`, `*.localhost`, `*.internal`, the platform service names and `crossfade-*` are always refused. One upstream cannot be listed under two apps. | `lib/core/allowlist.ts`, `lib/core/allowlist.test.ts`, `lib/apps.ts` |
| **One app's release affecting another app** | API keys are scoped to apps, and scope is checked before existence, so keys cannot probe other apps. Composite foreign keys keep versions and releases inside their app. The output validator refuses a route that references another app's cluster. | `lib/core/policy.ts`, `tests/releases-api.db.test.ts`, `tests/catalog.db.test.ts`, `lib/xds/validate.ts` |
| **A config that Envoy rejects, or that breaks routing, getting published** | Every snapshot is rendered and validated inside the transaction that changes the data, and a failure rolls the whole change back. The validator checks cluster references, reserved names, duplicate domains, prefix order and split weights. CI runs `envoy --mode validate` on the bootstraps and rendered fixtures. | `lib/xds/publish.ts`, `tests/publish-rollback.db.test.ts`, `lib/xds/validate.test.ts`, `scripts/envoy-validate.sh` |
| **A valid config that still destroys traffic** (a bad version) | New versions get 0% until a release starts. Health, convergence and error-budget gates run with automatic rollback. | `lib/engine/decide.ts`, `lib/engine/decide.test.ts`, `scripts/e2e.mjs` |
| **Reading the config, or tester tokens, from the xDS endpoint** | A node token is required, compared as SHA-256 digests in constant time. Request bodies are capped at 1 MiB, declared or streamed. | `app/v3/[resource]/route.ts`, `lib/core/hash.ts`, `tests/xds-route.db.test.ts` |
| **Abusing Envoy's admin API** | The admin API listens on loopback inside the container. The `:9902` listener is not published and serves only `GET /stats` with the token header; anything else gets 404. | `envoy/envoy.yaml`, `scripts/e2e.mjs` |
| **Taking over the console** | Public sign-up is disabled. The first account comes only from the one-time setup token, with a Host check and an advisory lock against races. Passwords need 12–128 characters. Sign-in is rate limited. Auth request bodies are capped at 4 KB. | `lib/auth-options.ts`, `lib/setup.ts`, `tests/setup.db.test.ts`, `tests/auth-route.db.test.ts` |
| **Cross-site requests from a browser** | Cookie-authenticated API routes require JSON and an `Origin` equal to the configured dashboard origin. Server actions get Next.js's origin check. Session cookies belong to the dashboard origin (`127.0.0.1:3000`), so they are never sent to apps on the edge. | `lib/dal.ts`, `tests/releases-api.db.test.ts` |
| **Doing harm through an impersonated session** | Impersonated sessions are read-only: no releases, approvals or settings changes, only "stop impersonating". | `lib/core/policy.ts`, `app/api/auth/[...all]/route.ts`, `tests/auth-route.db.test.ts` |
| **Stolen or leftover API keys** | Keys are stored hashed, shown once, revocable and scoped to apps. A key stops working when its owner is banned or deleted. Better Auth's own key routes are blocked, so every key goes through the scoped path. | `lib/settings.ts`, `lib/dal.ts`, `tests/api-keys.db.test.ts`, `tests/auth-route.db.test.ts` |
| **Self-approving a release** on an app that needs four eyes | A release's creator, and the owner of the key that created it, cannot approve it. Impersonated sessions and API keys never can. | `lib/core/policy.ts`, `tests/approvals.db.test.ts` |
| **Leaking tester tokens** | Tokens are redacted from every config view (a test checks that no 64-hex string survives). Reveal is admin-only and audited. Tokens are rotatable. The tester route exists only while a release is pending or warming, and Envoy strips the header before the request reaches the app. | `lib/core/inspect.ts`, `lib/core/inspect.test.ts`, `lib/xds/render.ts` |
| **Secrets in git, images or process lists** | `init` generates the secrets into a volume with mode 0600. Compose files and images never contain them. `.env*` is ignored by git and Docker, and CI checks that no `.env` reached the image. Envoy gets the xDS token through its entrypoint, not its command line. | `compose.yaml`, `.dockerignore`, `.github/workflows/ci.yml`, `envoy/entrypoint.sh` |
| **Abusive clients at the edge** | Envoy applies a connection cap, header and idle timeouts, rejects headers with underscores, normalizes paths, sets HTTP/2 limits and drops query strings from access logs. | `envoy/envoy.yaml` |
| **Background workers depending on request-scoped code** | An ESLint boundary keeps `next/*`, React, auth and the request-scoped data layer out of every module the workers import. | `eslint.config.mjs` |
| **Changes nobody can account for** | Every change writes an event with its actor kind (user, API key, engine or system) and id. | `lib/events.ts` |

## Known limits

These are accepted for v0.1.0. Plan around them.

- **No independent audit.**
- **No TLS on the edge, and none between containers.** Terminate TLS in a proxy in front of Envoy (see the production checklist in the README). Traffic between containers on the Docker networks is plain TCP.
- **The canary verdict trusts its traffic.**
  - The sticky split hashes the client-supplied leftmost `X-Forwarded-For`, so clients choose their bucket.
  - A client who can send enough requests to the candidate can push a release either way: failing requests force a rollback, and successful ones dilute real errors.
  - Stickiness is for user experience, not a security boundary.
- **Four-eyes approval stops mistakes, not a malicious admin.** Admins can create accounts and change app settings, including turning approval off.
- **The xDS token also guards Envoy's stats listener.** One secret covers both paths between the control plane and Envoy.
- **Rate limits are minimal.**
  - Sign-in uses one shared bucket of 10 attempts a minute, because the dashboard sees no client IP it can trust. Someone who can reach the dashboard can therefore slow everyone's sign-ins.
  - `PUT /api/v1/releases/:id` is not rate limited.
- **The setup URL is printed to the `migrate` log** until the first account exists. Anyone who can read the Docker logs before setup can claim the installation. Finish setup right after the first start.
- **Docker-published ports bypass `ufw`** on many Linux hosts. Keep `DASHBOARD_BIND=127.0.0.1`, and firewall the edge at the host or provider level.
- **Single edge node.** Running more than one Envoy is not covered by v0.1.0.
