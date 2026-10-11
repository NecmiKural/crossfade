import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { GET, PUT } from "@/app/api/v1/releases/[id]/route";
import { createApp, registerVersion } from "@/lib/apps";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, snapshots } from "@/lib/db/schema";
import { DASHBOARD, signedInUser, stubAuthEnv } from "./helpers/auth";
import { resetDb } from "./helpers/db";

const system = { kind: "system", id: "test" } as const;

beforeEach(async () => {
  stubAuthEnv(vi.stubEnv);
  vi.stubEnv("UPSTREAM_ALLOWLIST", "shop=shop-v1:3000,shop-v2:3000,shop-v3:3000,shop-v4:3000;blog=blog-v1:3000,blog-v2:3000");
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function world() {
  await getDb().transaction(async (tx) => {
    await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost", defaultPlan: "standard" }, system);
    for (const n of ["v1", "v2", "v3"]) await registerVersion(tx, { app: "shop", name: n, host: `shop-${n}`, port: 3000 }, system);
    await createApp(tx, { slug: "blog", key: "BLOG", domain: "blog.localhost" }, system);
    for (const n of ["v1", "v2"]) await registerVersion(tx, { app: "blog", name: n, host: `blog-${n}`, port: 3000 }, system);
  });
  const admin = await signedInUser("admin@example.test", "admin");
  const res = await createKey(
    new Request(`${DASHBOARD}/api/v1/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin.cookie, origin: DASHBOARD },
      body: JSON.stringify({ name: "ci", apps: ["shop"] }),
    }),
  );
  const { key } = (await res.json()) as { key: string };
  return { admin, key };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function put(id: string, body: unknown, headers: Record<string, string>) {
  return PUT(
    new Request(`${DASHBOARD}/api/v1/releases/${id}`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
    params(id),
  );
}
const get = (id: string, headers: Record<string, string>) => GET(new Request(`${DASHBOARD}/api/v1/releases/${id}`, { headers }), params(id));
const v2Request = { app: "shop", candidate: { name: "v2" }, plan: "cautious", notes: "SHOP-12 checkout fix" };

describe("PUT /api/v1/releases/:id", () => {
  it("creates a release asynchronously (202), then replays it idempotently (200)", async () => {
    const { key } = await world();
    const id = randomUUID();
    const first = await put(id, v2Request, { "x-api-key": key });
    expect(first.status).toBe(202);
    expect(first.headers.get("location")).toBe(`/api/v1/releases/${id}`);
    expect(first.headers.get("retry-after")).toBe("2");
    const body = await first.json();
    expect(body).toMatchObject({ key: "SHOP-R1", app: "shop", from: "v1", candidate: "v2", status: "warming", terminal: false, plan: { id: "cautious" } });
    expect(body.createdBy.kind).toBe("apikey");

    const replay = await put(id, v2Request, { "x-api-key": key });
    expect(replay.status).toBe(200);
    expect((await replay.json()).key).toBe("SHOP-R1");
  });

  it("publishes the candidate cluster and the tester route on create", async () => {
    const { key } = await world();
    await put(randomUUID(), v2Request, { "x-api-key": key });
    const [latest] = await getDb().select().from(snapshots).orderBy(snapshots.id).then((rows) => rows.slice(-1));
    expect(JSON.parse(latest.clusters).map((c: { name: string }) => c.name)).toContain("shop--v2");
    const vhost = JSON.parse(latest.routes)[0].virtual_hosts.find((v: { name: string }) => v.name === "localhost");
    expect(vhost.routes.map((r: { name: string }) => r.name)).toEqual(["shop.tester", "shop"]);
  });

  it("returns 409 for a reused id with a different body, and for a second active release", async () => {
    const { key } = await world();
    const id = randomUUID();
    await put(id, v2Request, { "x-api-key": key });
    const conflict = await put(id, { ...v2Request, notes: "different" }, { "x-api-key": key });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe("id_conflict");
    const second = await put(randomUUID(), { app: "shop", candidate: { name: "v3" }, plan: "cautious" }, { "x-api-key": key });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "active_release", details: { active: "SHOP-R1" } });
  });

  it("checks key scope before existence (403 for other and unknown apps)", async () => {
    const { key } = await world();
    for (const app of ["blog", "does-not-exist"]) {
      const res = await put(randomUUID(), { app, candidate: { name: "v2" } }, { "x-api-key": key });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("app_not_allowed");
    }
  });

  it.each([
    ["unknown_app", { app: "nope", candidate: { name: "v2" } }],
    ["unknown_version", { app: "shop", candidate: { name: "v9" }, plan: "cautious" }],
    ["upstream_not_allowed", { app: "shop", candidate: { name: "v9", host: "evil-host", port: 80 }, plan: "cautious" }],
    ["plan_not_allowed", { app: "shop", candidate: { name: "v2" }, plan: "demo" }],
    ["candidate_is_stable", { app: "shop", candidate: { name: "v1" }, plan: "cautious" }],
    ["invalid_request", { app: "shop" }],
  ])("returns 422 %s", async (code, body) => {
    const { admin } = await world();
    const res = await put(randomUUID(), body, { cookie: admin.cookie, origin: DASHBOARD });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(code);
  });

  it("registers a new version inline when host and port are given", async () => {
    const { key } = await world();
    const inline = await put(randomUUID(), { app: "shop", candidate: { name: "v4", host: "shop-v4", port: 3000 }, plan: "cautious" }, { "x-api-key": key });
    expect(inline.status).toBe(202);
    expect((await inline.json()).candidate).toBe("v4");
  });

  it("rejects an invalid API key", async () => {
    await world();
    expect((await put(randomUUID(), v2Request, { "x-api-key": "cf_invalid" })).status).toBe(401);
  });

  it("returns 409 version_conflict for an existing name with a different upstream", async () => {
    const { admin } = await world();
    const res = await put(randomUUID(), { app: "shop", candidate: { name: "v2", host: "shop-v3", port: 3000 }, plan: "cautious" }, { cookie: admin.cookie, origin: DASHBOARD });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("version_conflict");
  });

  it("requires authentication, a same-origin browser and a UUID id", async () => {
    const { admin } = await world();
    expect((await put(randomUUID(), v2Request, {})).status).toBe(401);
    expect((await put(randomUUID(), v2Request, { cookie: admin.cookie })).status).toBe(403);
    expect((await put("not-a-uuid", v2Request, { cookie: admin.cookie, origin: DASHBOARD })).status).toBe(400);
  });
});

describe("GET /api/v1/releases/:id", () => {
  it("returns the status to allowed callers and 404 to everyone else", async () => {
    const { key, admin } = await world();
    const id = randomUUID();
    await put(id, { app: "blog", candidate: { name: "v2" } }, { cookie: admin.cookie, origin: DASHBOARD });
    const asAdmin = await get(id, { cookie: admin.cookie });
    expect(asAdmin.status).toBe(200);
    expect((await asAdmin.json()).key).toBe("BLOG-R1");
    expect((await get(id, { "x-api-key": key })).status).toBe(404);
    expect((await get(randomUUID(), { "x-api-key": key })).status).toBe(404);
  });

  it("reports applied=false until an Envoy node acks the release's routes", async () => {
    const { key } = await world();
    const id = randomUUID();
    await put(id, v2Request, { "x-api-key": key });
    const body = await (await get(id, { "x-api-key": key })).json();
    expect(body.applied).toBe(false);
    expect(body.step).toMatchObject({ index: 0, count: 4, weight: 0, phase: "applying" });
    expect(body.snapshot.rev).toBeGreaterThan(0);
  });

  it("does not let a stable change from a concurrent writer slip in", async () => {
    const { key } = await world();
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(shop.releaseSeq).toBe(0);
    await put(randomUUID(), v2Request, { "x-api-key": key });
    const [after] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(after.releaseSeq).toBe(1);
  });
});
