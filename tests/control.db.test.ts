import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, events, incidents, releases, user } from "@/lib/db/schema";
import { controlRelease } from "@/lib/releases/control";
import { createRelease } from "@/lib/releases/create";
import { resetDb } from "./helpers/db";

const system = { kind: "system", id: "test" } as const;
const alice = { kind: "user", id: "u-alice", role: "user", readOnly: false } as const;
const bob = { kind: "user", id: "u-bob", role: "user", readOnly: false } as const;
const ciKey = { kind: "apikey", id: "key-1", ownerId: "u-alice", apps: ["shop"] } as const;

beforeEach(async () => {
  vi.stubEnv("UPSTREAM_ALLOWLIST", "shop=shop-v1:3000,shop-v2:3000");
  await resetDb();
  await getDb().insert(user).values([
    { id: "u-alice", name: "Alice", email: "alice@example.test" },
    { id: "u-bob", name: "Bob", email: "bob@example.test" },
  ]);
  await getDb().transaction(async (tx) => {
    await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost", defaultPlan: "manual" }, system);
    for (const n of ["v1", "v2"]) await registerVersion(tx, { app: "shop", name: n, host: `shop-${n}`, port: 3000 }, system);
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

async function liveRelease(): Promise<string> {
  const { releaseId } = await createRelease(getDb(), { id: randomUUID(), body: { app: "shop", candidate: { name: "v2" } }, actor: alice });
  await getDb().update(releases).set({ status: "rolling", weight: 10, stepLiveAt: new Date() }).where(eq(releases.id, releaseId));
  return releaseId;
}
const load = async (id: string) => (await getDb().select().from(releases).where(eq(releases.id, id)))[0];

describe("controlRelease", () => {
  it("advances a manual-plan release only when someone clicks, then promotes it", async () => {
    const id = await liveRelease();
    const advanced = await controlRelease(getDb(), { id, control: "advance", actor: alice });
    expect(advanced).toMatchObject({ stepIndex: 1, weight: 50, stepLiveAt: null });
    await getDb().update(releases).set({ stepLiveAt: new Date() }).where(eq(releases.id, id));
    const promoted = await controlRelease(getDb(), { id, control: "advance", actor: alice });
    expect(promoted.status).toBe("promoted");
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(shop.stableVersionId).toBe(promoted.candidateVersionId);
  });

  it("pauses and resumes with an audit trail naming the person", async () => {
    const id = await liveRelease();
    await controlRelease(getDb(), { id, control: "pause", actor: bob });
    await controlRelease(getDb(), { id, control: "resume", actor: alice });
    const trail = await getDb().select().from(events).where(eq(events.releaseId, id)).orderBy(events.id);
    expect(trail.filter((e) => e.type !== "release.created").map((e) => [e.type, e.actorId])).toEqual([
      ["release.paused", "u-bob"],
      ["release.resumed", "u-alice"],
    ]);
  });

  it("aborts without filing an incident", async () => {
    const id = await liveRelease();
    const aborted = await controlRelease(getDb(), { id, control: "abort", actor: bob });
    expect(aborted).toMatchObject({ status: "cancelled", weight: 0 });
    expect(await getDb().select().from(incidents)).toHaveLength(0);
  });

  it("refuses invalid states, API keys and impersonated sessions", async () => {
    const id = await liveRelease();
    await expect(controlRelease(getDb(), { id, control: "resume", actor: alice })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(controlRelease(getDb(), { id, control: "abort", actor: ciKey })).rejects.toMatchObject({ code: "forbidden" });
    await expect(controlRelease(getDb(), { id, control: "pause", actor: { ...bob, readOnly: true } })).rejects.toMatchObject({ code: "forbidden" });
    expect((await load(id)).status).toBe("rolling");
  });

  it("returns not_found for unknown releases", async () => {
    await expect(controlRelease(getDb(), { id: randomUUID(), control: "abort", actor: alice })).rejects.toMatchObject({ code: "not_found" });
  });
});
