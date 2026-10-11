import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, events, releases, snapshots, user } from "@/lib/db/schema";
import type { DecideResult } from "@/lib/engine/types";
import { applyResult } from "@/lib/releases/apply";
import { createRelease } from "@/lib/releases/create";
import { resetDb } from "./helpers/db";

const system = { kind: "system", id: "test" } as const;
const engine = { kind: "engine", id: null } as const;
const alice = { kind: "user", id: "u-alice", role: "user", readOnly: false } as const;

beforeEach(async () => {
  vi.stubEnv("UPSTREAM_ALLOWLIST", "shop=shop-v1:3000,shop-v2:3000,shop-v3:3000");
  await resetDb();
  await getDb().insert(user).values({ id: "u-alice", name: "Alice", email: "alice@example.test" });
  await getDb().transaction(async (tx) => {
    await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost", defaultPlan: "demo" }, system);
    for (const n of ["v1", "v2", "v3"]) await registerVersion(tx, { app: "shop", name: n, host: `shop-${n}`, port: 3000 }, system);
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const create = (candidate: string) => createRelease(getDb(), { id: randomUUID(), body: { app: "shop", candidate: { name: candidate } }, actor: alice });
const load = async (id: string) => (await getDb().select().from(releases).where(eq(releases.id, id)))[0];
const latestRoute = async () => {
  const rows = await getDb().select().from(snapshots).orderBy(snapshots.id);
  return JSON.parse(rows[rows.length - 1].routes)[0].virtual_hosts.find((v: { name: string }) => v.name === "localhost").routes;
};

function result(state: Partial<DecideResult["release"]>, extra: Partial<DecideResult> = {}): DecideResult {
  return {
    release: { status: "rolling", stepIndex: 0, weight: 10, stepLiveAt: null, baseline: null, holdReason: null, holdDetail: null, ...state },
    events: [],
    publish: false,
    ...extra,
  };
}

describe("applyResult", () => {
  it("publishes the split when a step starts and records the snapshot on the release", async () => {
    const { releaseId } = await create("v2");
    const before = await load(releaseId);
    const after = await getDb().transaction(async (tx) => applyResult(tx, before, result({ weight: 10 }, { publish: true, events: [{ type: "gate.health_passed", message: "ok" }] }), engine));
    expect(after).toMatchObject({ status: "rolling", weight: 10, finishedAt: null });
    expect(after.snapshotId).toBeGreaterThan(before.snapshotId ?? 0);
    expect((await latestRoute())[0].route.weighted_clusters.clusters).toEqual([
      { name: "shop--v1", weight: 90 },
      { name: "shop--v2", weight: 10 },
    ]);
  });

  it("makes the candidate stable on promotion", async () => {
    const { releaseId } = await create("v2");
    const before = await load(releaseId);
    const outcome = { kind: "promoted", reason: "completed", evidence: {} } as const;
    const after = await getDb().transaction((tx) => applyResult(tx, before, result({ status: "promoted", weight: 100 }, { publish: true, outcome }), engine));
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(shop.stableVersionId).toBe(before.candidateVersionId);
    expect(after.finishedAt).not.toBeNull();
    expect(after.outcome).toEqual(outcome);
    expect((await latestRoute())[0].route).toEqual({ cluster: "shop--v2", timeout: "60s" });
  });

  it("sends all traffic back to stable on abort", async () => {
    const { releaseId } = await create("v2");
    const rolling = await getDb().transaction(async (tx) => applyResult(tx, await load(releaseId), result({ weight: 50 }, { publish: true }), engine));
    const outcome = { kind: "cancelled", reason: "manual", evidence: {} } as const;
    await getDb().transaction((tx) => applyResult(tx, rolling, result({ status: "cancelled", weight: 0 }, { publish: true, outcome }), { kind: "user", id: "u-alice" }));
    const routes = await latestRoute();
    expect(routes.map((r: { name: string }) => r.name)).toEqual(["shop"]);
    expect(routes[0].route).toEqual({ cluster: "shop--v1", timeout: "60s" });
  });

  it("writes one hold event per reason change, not one per tick", async () => {
    const { releaseId } = await create("v2");
    for (let i = 0; i < 3; i++) {
      const current = await load(releaseId);
      await getDb().transaction((tx) => applyResult(tx, current, result({ status: "warming", weight: 0, holdReason: "candidate_not_healthy" }), engine));
    }
    const holds = await getDb().select().from(events).where(eq(events.type, "engine.hold"));
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ actorKind: "engine", releaseId });
  });

  it("lets a create that races an engine promotion wait instead of deadlocking", async () => {
    const { releaseId } = await create("v2");
    const outcome = { kind: "promoted", reason: "completed", evidence: {} } as const;
    const promotion = getDb().transaction(async (tx) => {
      const [locked] = await tx.select().from(releases).where(eq(releases.id, releaseId)).for("update");
      await sleep(300); // the create below starts while the engine holds the release row
      return applyResult(tx, locked, result({ status: "promoted", weight: 100 }, { publish: true, outcome }), engine);
    });
    await sleep(50);
    const racingCreate = create("v3");
    const [promoted, created] = await Promise.all([promotion, racingCreate]);
    expect(promoted.status).toBe("promoted");
    const next = await load(created.releaseId);
    expect(next.number).toBe(2);
    expect(next.fromVersionId).toBe(promoted.candidateVersionId);
  });
});
