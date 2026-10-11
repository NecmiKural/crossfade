import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { closeDb, getDb } from "@/lib/db/client";
import { events, incidents, releases, user } from "@/lib/db/schema";
import type { DecideResult, Outcome } from "@/lib/engine/types";
import { applyResult } from "@/lib/releases/apply";
import { createRelease } from "@/lib/releases/create";
import { releaseView } from "@/lib/releases/view";
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

const errorBudget: Outcome = { kind: "rolled_back", reason: "error_budget", evidence: { errorRate: 0.31, n: 41, errors: 13, maxErrorRate: 0.02 } };
const done = (outcome: Outcome): DecideResult => ({
  release: { status: outcome.kind, stepIndex: 0, weight: outcome.kind === "promoted" ? 100 : 0, stepLiveAt: null, baseline: null, holdReason: null, holdDetail: null },
  events: [],
  publish: true,
  outcome,
});

async function finishRelease(candidate: string, outcome: Outcome): Promise<string> {
  const { releaseId } = await createRelease(getDb(), { id: randomUUID(), body: { app: "shop", candidate: { name: candidate } }, actor: alice });
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(releases).where(eq(releases.id, releaseId)).for("update");
    await applyResult(tx, row, done(outcome), engine);
  });
  return releaseId;
}

describe("incidents", () => {
  it("are filed with the evidence when the engine rolls a release back", async () => {
    const id = await finishRelease("v2", errorBudget);
    const [incident] = await getDb().select().from(incidents);
    expect(incident).toMatchObject({ number: 1, status: "open", title: "v2 rolled back: 31% errors (n=41)", evidence: { reason: "error_budget", n: 41 } });
    const view = (await releaseView(getDb(), id))?.view;
    expect(view?.incident).toEqual({ key: "SHOP-1", status: "open", resolvedBy: null });
  });

  it("link a repeat rollback of the same version instead of duplicating it", async () => {
    await finishRelease("v2", errorBudget);
    const second = await finishRelease("v2", errorBudget);
    expect(await getDb().select().from(incidents)).toHaveLength(1);
    const linked = await getDb().select().from(events).where(eq(events.type, "incident.linked"));
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ releaseId: second, message: "SHOP-1 hit again by SHOP-R2" });
  });

  it("get their own key per version", async () => {
    await finishRelease("v2", errorBudget);
    await finishRelease("v3", { kind: "rolled_back", reason: "candidate_unhealthy", evidence: { healthy: 0 } });
    const rows = await getDb().select().from(incidents).orderBy(incidents.number);
    expect(rows.map((r) => [r.number, r.title])).toEqual([
      [1, "v2 rolled back: 31% errors (n=41)"],
      [2, "v3 rolled back: failed its health checks mid-rollout"],
    ]);
  });

  it("close themselves when a later release of the app is promoted", async () => {
    const rolledBack = await finishRelease("v2", errorBudget);
    await finishRelease("v3", { kind: "promoted", reason: "completed", evidence: {} });
    const [incident] = await getDb().select().from(incidents);
    expect(incident.status).toBe("resolved");
    expect((await releaseView(getDb(), rolledBack))?.view.incident).toEqual({ key: "SHOP-1", status: "resolved", resolvedBy: "SHOP-R2" });
    const resolved = await getDb().select().from(events).where(eq(events.type, "incident.resolved"));
    expect(resolved[0].message).toBe("SHOP-1 resolved by SHOP-R2");
  });

  it("are not filed for cancellations", async () => {
    await finishRelease("v2", { kind: "cancelled", reason: "not_at_edge", evidence: {} });
    expect(await getDb().select().from(incidents)).toHaveLength(0);
  });
});
