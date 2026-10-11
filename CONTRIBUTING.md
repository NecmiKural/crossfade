# Contributing to Crossfade

Thanks for helping. Bug reports, fixes, docs and well-argued ideas are all welcome. For anything larger than a small fix, open an issue first so we can agree on the approach before you spend time on it. Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Set up

You need:
- Node **24.21.0**, pinned in `.nvmrc`; `nvm use` picks it up;
- npm 11, which ships with that Node;
- Docker with Compose v2.

```sh
nvm use
npm ci
docker compose -f compose.dev.yaml up -d --wait     # Postgres on 127.0.0.1:5432, dev-only credentials
```

## Run the console locally

`next dev` reads `.env.local`, which git ignores. Create it once:

```sh
cat > .env.local <<EOF
DATABASE_URL=postgres://crossfade:crossfade-dev-only@127.0.0.1:5432/crossfade
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
XDS_TOKEN=$(openssl rand -hex 32)
SETUP_TOKEN=$(openssl rand -hex 32)
UPSTREAM_ALLOWLIST=shop=shop-v1:3000,shop-v2:3000,shop-v3:3000
EOF
```

Then migrate, seed and start:

```sh
npm run build:workers
node --env-file=.env.local dist/migrate.mjs    # prints the setup URL on the first run
node --env-file=.env.local dist/seed.mjs       # optional: the demo app "shop"
npm run dev
```

Open the setup URL that `migrate` printed, create an account, and work on the console at <http://127.0.0.1:3000>.

There is no Envoy or engine in this mode, so releases hold with `no Envoy node is polling`. To see the whole loop, with real traffic and rollbacks, run the compose demo from the README.

## Checks

CI runs all of these, and a pull request needs them green:

| Command | What it checks |
|---|---|
| `npm run lint` | ESLint, including the boundary that keeps `next/*`, React and auth out of the worker code. |
| `npm run typecheck` | Route types plus `tsc --noEmit`. |
| `npm test` | Unit tests (Vitest). |
| `npm run coverage` | Unit tests with an 80% gate on `lib/core`, `lib/xds` and `lib/engine`. |
| `npm run test:db` | Database tests against `crossfade_test`, which the suite creates in the dev Postgres. The suite refuses any database whose name does not end in `_test`. |
| `./scripts/envoy-validate.sh envoy/envoy.yaml envoy/envoy.behind-proxy.yaml envoy/fixtures/*.json` | The bootstraps and rendered fixtures, through the real `envoy --mode validate`. |
| `npm run e2e` | The full compose stack. It builds the image, then proves rollback, promotion, scoping and the control-plane-down fail-safe. It takes about 3 minutes and removes the stack afterwards; set `E2E_KEEP=1` to keep it running. |

The e2e builds a Docker image each time. Clean the build cache now and then with `docker builder prune`.

## How we write code

- **Test first** for logic: write the failing test, then the code.
  - Pure modules (`lib/core`, `lib/xds`, `lib/engine`) get table-driven unit tests.
  - Anything that touches Postgres gets a `*.db.test.ts` under `tests/`.
- **Keep the core pure.**
  - `decide()`, the renderers, the validator and the policy take plain data and return plain data.
  - Side effects live in `lib/releases`, `lib/xds/publish.ts` and the server actions.
- **One way in for authorization.** Every route handler and server action goes through `lib/dal.ts` and `can()` in `lib/core/policy.ts`.
- **Every change to routing publishes.**
  - If you change data the renderer reads, call `publishSnapshot` in the same transaction.
  - If you change what is rendered, update the fixtures under `envoy/fixtures/` and run the validate script.
- **Schema changes** go through `npm run db:generate`. They must follow expand/contract, because `migrate` runs while the previous version is still serving. See [Writing schema changes](docs/RUNBOOK.md#writing-schema-changes).
- **Exact versions.** `.npmrc` sets `save-exact`. Add a dependency only when a few lines of code cannot do the job.
- **Decisions get a record.** If a change alters a choice described in `docs/adr/`, add or update an ADR.
- **English** for code, comments, commits and docs.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(engine): …`, `fix(console): …`, `docs: …`, `chore(deps): …`.
- Keep one logical change per commit, and make sure every commit passes the checks on its own.
- In the pull request:
  - describe what changed and why;
  - say how you tested it, including any manual steps in the console;
  - add screenshots for UI changes.

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
