// End-to-end smoke test against the real compose stack (demo profile).
// Deterministic: every wait is a poll with a deadline, never a fixed sleep.
// Tears the stack down at the end unless E2E_KEEP=1.
import { spawnSync } from "node:child_process";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const EDGE = "http://localhost:8080";
const WEB = "http://127.0.0.1:3000";
const out = (line) => process.stdout.write(`${line}\n`);

function compose(args, { capture = false } = {}) {
  const result = spawnSync("docker", ["compose", "--profile", "demo", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "").trim();
}

/** Runs a node snippet inside a service container (to reach internal-only ports). */
const inside = (service, code) => compose(["exec", "-T", service, "node", "-e", code], { capture: true });

async function poll(label, check, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for: ${label}${last ? ` (last error: ${last.message})` : ""}`);
}

/** GET with arbitrary headers (fetch forbids overriding Host). Resolves to { status, body }. */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

// ---- edge slice (commit 16) ----

step("image ships no .env files", () => {
  const found = spawnSync(
    "docker",
    ["run", "--rm", "--user", "root", "--entrypoint", "sh", "crossfade:local", "-c", 'find / -xdev -name ".env*" -not -path "/proc/*" 2>/dev/null || true'],
    { encoding: "utf8" },
  ).stdout.trim();
  assert(found === "", `.env files in the image: ${found}`);
});

step("the edge serves shop v1 from config rendered in Postgres", async () => {
  await poll("shop v1 on :8080", async () => (await httpGet(`${EDGE}/`)).body.includes("shop v1"));
});

step("unknown hosts get the fallback 404", async () => {
  const { status, body } = await httpGet(`${EDGE}/`, { host: "nope.example" });
  assert(status === 404 && body.includes("no app for this host"), `expected the fallback 404, got ${status}`);
});

step("xDS rejects a wrong node token", async () => {
  const res = await fetch(`${WEB}/v3/discovery:clusters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ node: { id: "e2e", metadata: { xds_token: "wrong" } } }),
  });
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

step("the stats listener only answers GET /stats with the platform token", () => {
  const token = compose(["exec", "-T", "web", "cat", "/run/crossfade/xds_token"], { capture: true });
  const fromControl = inside(
    "web",
    `const h={"x-crossfade-stats":${JSON.stringify(token)}};Promise.all([fetch("http://envoy:9902/stats?filter=server.uptime",{headers:h}),fetch("http://envoy:9902/stats",{method:"POST",headers:h}),fetch("http://envoy:9902/clusters",{headers:h}),fetch("http://envoy:9902/stats")]).then(rs=>process.stdout.write(rs.map(r=>r.status).join(",")))`,
  );
  assert(fromControl === "200,404,404,404", `unexpected stats listener statuses from web: ${fromControl}`);
  const fromApps = inside("traffic", `fetch("http://envoy:9902/stats?filter=shop").then(r=>process.stdout.write(String(r.status)))`);
  assert(fromApps === "404", `an upstream container must not read edge stats, got ${fromApps}`);
});

step("the xDS token is not on Envoy's command line", () => {
  const token = compose(["exec", "-T", "web", "cat", "/run/crossfade/xds_token"], { capture: true });
  const cmdline = compose(["exec", "-T", "envoy", "cat", "/proc/1/cmdline"], { capture: true });
  assert(cmdline.includes("envoy") && !cmdline.includes(token), "the token leaked into Envoy's argv");
});

// ---- accounts (commit 17) ----

const owner = { name: "E2E Owner", email: "owner@e2e.test", password: "correct-horse-battery" };
const jsonPost = (path, body, headers = {}) =>
  fetch(`${WEB}${path}`, {
    method: "POST",
    // Node's fetch sends Sec-Fetch-Mode, so Better Auth also wants an Origin it trusts.
    headers: { "content-type": "application/json", origin: WEB, ...headers },
    body: JSON.stringify(body),
  });

step("first-run setup needs the one-time token and works exactly once", async () => {
  const token = compose(["exec", "-T", "web", "cat", "/run/crossfade/setup_token"], { capture: true });
  assert((await jsonPost("/api/setup", { ...owner, token: "wrong" })).status === 401, "a wrong setup token must be rejected");
  const first = await jsonPost("/api/setup", { ...owner, token });
  assert(first.status === 201, `expected 201 from setup, got ${first.status}`);
  const second = await jsonPost("/api/setup", { ...owner, email: "second@e2e.test", token });
  assert(second.status === 403, `expected 403 on the second setup, got ${second.status}`);
});

step("public sign-up is disabled", async () => {
  const res = await jsonPost("/api/auth/sign-up/email", { name: "Mallory", email: "m@e2e.test", password: "correct-horse-battery" });
  assert(res.status === 400, `expected 400 from sign-up, got ${res.status}`);
});

const session = { cookie: "" };

step("the owner can sign in", async () => {
  const res = await jsonPost("/api/auth/sign-in/email", { email: owner.email, password: owner.password });
  assert(res.status === 200, `expected 200 from sign-in, got ${res.status}`);
  session.cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
  assert(/session_token/.test(session.cookie), "sign-in must set a session cookie");
});

// ---- releases (commit 29) ----

const ci = { key: "", xdsToken: "" };
const putRelease = (id, body, key = ci.key) =>
  fetch(`${WEB}/api/v1/releases/${id}`, { method: "PUT", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify(body) });
const getRelease = async (id) => (await fetch(`${WEB}/api/v1/releases/${id}`, { headers: { "x-api-key": ci.key } })).json();
const until = (id, label, predicate, timeoutMs = 150_000) =>
  poll(label, async () => {
    const status = await getRelease(id);
    return predicate(status) ? status : false;
  }, { timeoutMs, intervalMs: 1000 });
const versionsServed = async (n) => {
  const seen = { v1: 0, v2: 0, v3: 0, errors: 0 };
  for (let i = 0; i < n; i++) {
    const { status, body } = await httpGet(`${EDGE}/`, { "x-forwarded-for": `10.20.${Math.floor(i / 250)}.${i % 250}` });
    if (status >= 500) seen.errors++;
    const version = /shop (v\d)/.exec(body)?.[1];
    if (version) seen[version]++;
  }
  return seen;
};
const edgeCounter = (name) =>
  Number(
    inside(
      "traffic",
      `fetch("http://envoy:9902/stats?filter=" + encodeURIComponent(${JSON.stringify(`^${name.replaceAll(".", "\\.")}$`)}), {headers: {"x-crossfade-stats": ${JSON.stringify(ci.xdsToken)}}}).then(r => r.text()).then(t => process.stdout.write((t.split(": ")[1] ?? "0").trim()))`,
    ),
  );
const releases = { bad: crypto.randomUUID(), good: crypto.randomUUID() };

step("an admin creates an app-scoped CI key", async () => {
  ci.xdsToken = compose(["exec", "-T", "web", "cat", "/run/crossfade/xds_token"], { capture: true });
  const res = await jsonPost("/api/v1/keys", { name: "e2e", apps: ["shop"] }, { cookie: session.cookie });
  const text = await res.text();
  assert(res.status === 201, `expected 201 creating a key, got ${res.status}: ${text}`);
  ci.key = JSON.parse(text).key;
});

step("PUT is idempotent: 202, then 200 for the same body, 409 for a different one", async () => {
  const body = { app: "shop", candidate: { name: "v2" }, notes: "SHOP-12 checkout" };
  const first = await putRelease(releases.bad, body);
  assert(first.status === 202, `expected 202, got ${first.status}`);
  assert((await putRelease(releases.bad, body)).status === 200, "a replay must return 200");
  assert((await putRelease(releases.bad, { ...body, notes: "changed" })).status === 409, "a changed body must return 409");
});

step("a bad release (30% errors behind a green /healthz) rolls back on its own and files SHOP-1", async () => {
  const done = await until(releases.bad, "v2 rolled back and applied", (s) => s.status === "rolled_back" && s.applied);
  const evidence = done.outcome?.evidence ?? {};
  assert(done.outcome?.reason === "error_budget", `expected an error-budget rollback, got ${JSON.stringify(done.outcome)}`);
  assert(evidence.errorRate > 0.02 && evidence.n >= 30, `weak evidence: ${JSON.stringify(evidence)}`);
  assert(done.incident?.key === "SHOP-1" && done.incident.status === "open", `expected SHOP-1 open, got ${JSON.stringify(done.incident)}`);
});

step("keys are scoped (403 for another app) and upstreams are allowlisted (422)", async () => {
  const other = await putRelease(crypto.randomUUID(), { app: "blog", candidate: { name: "v1" } });
  assert(other.status === 403, `expected 403 for another app, got ${other.status}`);
  const unlisted = await putRelease(crypto.randomUUID(), { app: "shop", candidate: { name: "v9", host: "evil-host", port: 80 } });
  const error = (await unlisted.json()).error;
  assert(unlisted.status === 422 && error === "upstream_not_allowed", `an unlisted upstream must be refused, got ${unlisted.status} ${error}`);
});

step("a good release splits traffic with zero 5xx", async () => {
  assert((await putRelease(releases.good, { app: "shop", candidate: { name: "v3" } })).status === 202, "v3 release must be accepted");
  await until(releases.good, "v3 live on the edge", (s) => s.status === "rolling" && s.applied && s.step.phase === "baking");
  const seen = await versionsServed(200);
  assert(seen.v1 > 0 && seen.v3 > 0 && seen.errors === 0 && seen.v2 === 0, `unexpected split: ${JSON.stringify(seen)}`);
});

step("with the control plane down, Envoy keeps serving the last good config", async () => {
  const cds = edgeCounter("cluster_manager.cds.update_failure");
  const rds = edgeCounter("http.edge.rds.edge.update_failure");
  compose(["stop", "web", "engine"], { capture: true });
  await poll("Envoy noticing the control plane is gone", () =>
    edgeCounter("cluster_manager.cds.update_failure") >= cds + 2 && edgeCounter("http.edge.rds.edge.update_failure") >= rds + 2,
  );
  const seen = await versionsServed(200);
  assert(seen.v1 > 0 && seen.v3 > 0 && seen.errors === 0, `traffic changed while the control plane was down: ${JSON.stringify(seen)}`);
  compose(["start", "web", "engine"], { capture: true });
});

step("after recovery the good release is promoted and SHOP-1 resolves itself", async () => {
  const done = await until(releases.good, "v3 promoted and applied", (s) => s.status === "promoted" && s.applied);
  assert(done.key === "SHOP-R2", `expected SHOP-R2, got ${done.key}`);
  const seen = await versionsServed(20);
  assert(seen.v3 === 20, `expected only v3 after promotion: ${JSON.stringify(seen)}`);
  const bad = await getRelease(releases.bad);
  assert(bad.incident?.status === "resolved" && bad.incident.resolvedBy === "SHOP-R2", `SHOP-1 not resolved: ${JSON.stringify(bad.incident)}`);
});

// ---- runner ----

async function main() {
  const started = Date.now();
  compose(["down", "-v", "--remove-orphans"]);
  compose(["up", "-d", "--build", "--wait", "--wait-timeout", "300"]);
  for (const { name, fn } of steps) {
    const t = Date.now();
    await fn();
    out(`  ok  ${name} (${Date.now() - t} ms)`);
  }
  out(`e2e passed: ${steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s`);
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  out(`FAIL ${error.message}`);
  spawnSync("docker", ["compose", "--profile", "demo", "logs", "--no-color", "--tail", "80"], { stdio: "inherit" });
} finally {
  if (process.env.E2E_KEEP !== "1") compose(["down", "-v", "--remove-orphans"]);
}
process.exitCode = failed ? 1 : 0;
