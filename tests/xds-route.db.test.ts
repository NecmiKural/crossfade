import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/v3/[resource]/route";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, edgeNodes } from "@/lib/db/schema";
import { publishSnapshot } from "@/lib/xds/publish";
import { insertApp, insertVersion, resetDb } from "./helpers/db";

const TOKEN = "test-xds-token";

beforeEach(async () => {
  vi.stubEnv("XDS_TOKEN", TOKEN);
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

function poll(resource: string, body: Record<string, unknown> | string, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request(`http://control-plane/v3/${resource}`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers },
    body: text,
  });
  return POST(request, { params: Promise.resolve({ resource }) });
}

const node = (token = TOKEN) => ({
  id: "edge-1",
  cluster: "crossfade-edge",
  metadata: { xds_token: token },
  user_agent_build_version: { version: { major_number: 1, minor_number: 39, patch: 3 } },
});

async function publishShop() {
  const shop = await insertApp("shop", { domain: "localhost" });
  const v1 = await insertVersion(shop.id, "v1");
  await getDb().update(apps).set({ stableVersionId: v1.id }).where(eq(apps.id, shop.id));
  return getDb().transaction((tx) => publishSnapshot(tx, { reason: "test", actor: { kind: "system", id: null } }));
}

describe("POST /v3/[resource]", () => {
  it("serves the empty config at version 0 before any snapshot", async () => {
    const res = await poll("discovery:clusters", { node: node() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version_info: "0", resources: [] });
  });

  it("serves the latest snapshot, then 304 once Envoy has it, and records acks", async () => {
    const snap = await publishShop();
    const first = await poll("discovery:routes", { node: node() });
    expect(first.status).toBe(200);
    const payload = await first.json();
    expect(payload.version_info).toBe(String(snap.rdsVersion));
    expect(payload.resources[0]["@type"]).toBe("type.googleapis.com/envoy.config.route.v3.RouteConfiguration");

    const [afterFirst] = await getDb().select().from(edgeNodes);
    expect(afterFirst).toMatchObject({ nodeId: "edge-1", type: "rds", ackedVersion: null, servedVersion: snap.rdsVersion, envoyVersion: "1.39.3" });

    const second = await poll("discovery:routes", { node: node(), version_info: String(snap.rdsVersion) });
    expect(second.status).toBe(304);
    const [afterSecond] = await getDb().select().from(edgeNodes);
    expect(afterSecond.ackedVersion).toBe(snap.rdsVersion);
    expect(afterSecond.servedSince).toEqual(afterFirst.servedSince);
    expect(afterSecond.lastSeenAt.getTime()).toBeGreaterThanOrEqual(afterFirst.lastSeenAt.getTime());
  });

  it("rejects a wrong or missing token with 401", async () => {
    expect((await poll("discovery:clusters", { node: node("wrong") })).status).toBe(401);
    expect((await poll("discovery:clusters", { node: { id: "edge-1" } })).status).toBe(401);
    expect(await getDb().select().from(edgeNodes)).toHaveLength(0);
  });

  it("refuses bodies larger than 1 MiB, declared or streamed", async () => {
    expect((await poll("discovery:clusters", { node: node(), pad: "x".repeat(1_100_000) })).status).toBe(413);
    const chunked = (size: number) =>
      new Request("http://control-plane/v3/discovery:clusters", {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ node: node(), pad: "x".repeat(size) })));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
    const params = { params: Promise.resolve({ resource: "discovery:clusters" }) };
    expect((await POST(chunked(1_100_000), params)).status).toBe(413);
    // A realistic Envoy request is well above 64 KB because of node.extensions.
    expect((await POST(chunked(200_000), params)).status).toBe(200);
  });

  it("returns 404 for other resources and 400 for malformed bodies", async () => {
    expect((await poll("discovery:listeners", { node: node() })).status).toBe(404);
    expect((await poll("discovery:clusters", "{not json")).status).toBe(400);
    expect((await poll("discovery:clusters", { node: { id: "bad id!" } })).status).toBe(400);
  });
});
