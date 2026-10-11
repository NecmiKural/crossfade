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

step("the stats listener only answers GET /stats", () => {
  const statuses = inside(
    "traffic",
    `Promise.all([fetch("http://envoy:9902/stats",{method:"POST"}),fetch("http://envoy:9902/clusters"),fetch("http://envoy:9902/stats?filter=server.uptime")]).then(rs=>process.stdout.write(rs.map(r=>r.status).join(",")))`,
  );
  assert(statuses === "404,404,200", `unexpected stats listener statuses: ${statuses}`);
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
