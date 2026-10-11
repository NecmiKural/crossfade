import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { PLANS } from "@/lib/core/plans";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, events, heartbeats, releaseSamples, releases, user } from "@/lib/db/schema";
import { parseStats } from "@/lib/engine/stats";
import { runTick } from "@/lib/engine/tick";
import { resetDb } from "./helpers/db";

const system = { kind: "system", id: "test" } as const;
const SLUGS = ["a1", "b2", "c3", "d4", "e5"];

beforeEach(async () => {
  vi.stubEnv("UPSTREAM_ALLOWLIST", SLUGS.map((s) => `${s}=${s}-one:3000,${s}-two:3000`).join(";"));
  await resetDb();
  await getDb().insert(user).values({ id: "u1", name: "U", email: "u@example.test" });
  for (const slug of SLUGS) {
    await getDb().transaction(async (tx) => {
      const app = await createApp(tx, { slug, key: slug.toUpperCase(), domain: `${slug}.localhost`, defaultPlan: "demo" }, system);
      const one = await registerVersion(tx, { app: slug, name: "one", host: `${slug}-one`, port: 3000 }, system);
      const two = await registerVersion(tx, { app: slug, name: "two", host: `${slug}-two`, port: 3000 }, system);
      await tx.insert(releases).values({
        appId: app.id,
        number: 1,
        fromVersionId: one.id,
        candidateVersionId: two.id,
        plan: PLANS.demo,
        status: "warming",
        createdByKind: "user",
        createdByUserId: "u1",
        nextCheckAt: new Date(Date.now() - 1000),
      });
    });
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("runTick", () => {
  it("never processes a release twice, even with two engines claiming at once", async () => {
    const now = new Date();
    const [first, second] = await Promise.all([runTick(getDb(), null, now), runTick(getDb(), null, now)]);
    expect(first + second).toBe(SLUGS.length);
    const holds = await getDb().select().from(events).where(eq(events.type, "engine.hold"));
    expect(holds).toHaveLength(SLUGS.length);
    expect(new Set(holds.map((h) => h.releaseId)).size).toBe(SLUGS.length);
    const rows = await getDb().select().from(releases);
    expect(rows.every((r) => r.nextCheckAt > now && r.holdReason === "stats_unavailable")).toBe(true);
    expect(await getDb().select().from(heartbeats)).toHaveLength(1);
  });

  it("moves a healthy candidate to the first step and records a sample", async () => {
    const stats = parseStats({
      stats: [
        { name: "server.uptime", value: 600 },
        ...SLUGS.flatMap((s) => [
          { name: `cluster.${s}--one.membership_healthy`, value: 1 },
          { name: `cluster.${s}--one.upstream_rq_completed`, value: 500 },
          { name: `cluster.${s}--two.membership_healthy`, value: 1 },
        ]),
      ],
    });
    await runTick(getDb(), stats);
    const [a1] = await getDb().select().from(apps).where(eq(apps.slug, "a1"));
    const [release] = await getDb().select().from(releases).where(eq(releases.appId, a1.id));
    expect(release).toMatchObject({ status: "rolling", weight: 10 });
    expect(release.snapshotId).not.toBeNull();
    const samples = await getDb().select().from(releaseSamples).where(eq(releaseSamples.releaseId, release.id));
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ stableCompleted: 500, candidateCompleted: 0, candidateHealthy: 1 });
  });

  it("skips releases that are not due yet", async () => {
    await getDb().update(releases).set({ nextCheckAt: new Date(Date.now() + 60_000) });
    expect(await runTick(getDb(), null)).toBe(0);
  });
});

describe("runTick failure handling", () => {
  it("holds a release that fails to process as engine_error, once, and retries it later", async () => {
    const spy = vi.spyOn(await import("@/lib/releases/apply"), "applyResult").mockRejectedValueOnce(new Error("boom"));
    const now = new Date();
    await runTick(getDb(), null, now);
    spy.mockRestore();
    const failed = (await getDb().select().from(releases)).filter((r) => r.holdReason === "engine_error");
    expect(failed).toHaveLength(1);
    expect(failed[0].holdDetail).toEqual({ error: "boom" });
    expect(failed[0].nextCheckAt.getTime()).toBe(now.getTime() + 10_000);
    const holds = await getDb().select().from(events).where(eq(events.releaseId, failed[0].id));
    expect(holds.map((e) => e.type)).toEqual(["engine.hold"]);
  });
});
