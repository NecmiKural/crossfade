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
  assert(first.status === 201, `expected 201 from setup, got ${first.status}: ${await first.text()}`);
  const second = await jsonPost("/api/setup", { ...owner, email: "second@e2e.test", token });
  assert(second.status === 403, `expected 403 on the second setup, got ${second.status}`);
});

step("public sign-up is disabled", async () => {
  const res = await jsonPost("/api/auth/sign-up/email", { name: "Mallory", email: "m@e2e.test", password: "correct-horse-battery" });
  assert(res.status === 400, `expected 400 from sign-up, got ${res.status}`);
});

step("the owner can sign in", async () => {
  const res = await jsonPost("/api/auth/sign-in/email", { email: owner.email, password: owner.password });
  assert(res.status === 200, `expected 200 from sign-in, got ${res.status}: ${await res.text()}`);
  assert(/session_token/.test(res.headers.get("set-cookie") ?? ""), "sign-in must set a session cookie");
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
