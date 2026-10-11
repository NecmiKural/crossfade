import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { updateAppSettings } from "@/lib/apps-admin";
import { closeDb, getDb } from "@/lib/db/client";
import { releases, user } from "@/lib/db/schema";
import { runTick } from "@/lib/engine/tick";
import { controlRelease } from "@/lib/releases/control";
import { createRelease } from "@/lib/releases/create";
import { resetDb } from "./helpers/db";

const system = { kind: "system", id: "test" } as const;
const admin = { kind: "user", id: "u-admin", role: "admin", readOnly: false } as const;
const alice = { kind: "user", id: "u-alice", role: "user", readOnly: false } as const;
const bob = { kind: "user", id: "u-bob", role: "user", readOnly: false } as const;
const aliceKey = { kind: "apikey", id: "key-a", ownerId: "u-alice", apps: ["shop"] } as const;

beforeEach(async () => {
  vi.stubEnv("UPSTREAM_ALLOWLIST", "shop=shop-v1:3000,shop-v2:3000");
  await resetDb();
  await getDb().insert(user).values([
    { id: "u-admin", name: "Admin", email: "admin@example.test", role: "admin" },
    { id: "u-alice", name: "Alice", email: "alice@example.test" },
    { id: "u-bob", name: "Bob", email: "bob@example.test" },
  ]);
  await getDb().transaction(async (tx) => {
    await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost", defaultPlan: "demo" }, system);
    for (const n of ["v1", "v2"]) await registerVersion(tx, { app: "shop", name: n, host: `shop-${n}`, port: 3000 }, system);
  });
  await updateAppSettings(getDb(), admin, "shop", { defaultPlan: "demo", sticky: true, requiresApproval: true });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const create = async (actor: typeof alice | typeof aliceKey = alice) =>
  (await createRelease(getDb(), { id: randomUUID(), body: { app: "shop", candidate: { name: "v2" } }, actor })).releaseId;
const statusOf = async (id: string) => (await getDb().select().from(releases).where(eq(releases.id, id)))[0].status;

describe("four-eyes approval", () => {
  it("starts releases in pending_approval, and the engine leaves them alone", async () => {
    const id = await create();
    expect(await statusOf(id)).toBe("pending_approval");
    await runTick(getDb(), null);
    expect(await statusOf(id)).toBe("pending_approval");
  });

  it("refuses approval by the creator, by the key owner, and by impersonated sessions", async () => {
    const byPerson = await create();
    await expect(controlRelease(getDb(), { id: byPerson, control: "approve", actor: alice })).rejects.toMatchObject({ code: "forbidden" });
    await controlRelease(getDb(), { id: byPerson, control: "abort", actor: alice });
    const byKey = await create(aliceKey);
    await expect(controlRelease(getDb(), { id: byKey, control: "approve", actor: alice })).rejects.toMatchObject({ code: "forbidden" });
    await expect(controlRelease(getDb(), { id: byKey, control: "approve", actor: { ...bob, readOnly: true } })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets a second person approve, which starts warming", async () => {
    const id = await create();
    const approved = await controlRelease(getDb(), { id, control: "approve", actor: bob });
    expect(approved.status).toBe("warming");
  });

  it("stops the creator from advancing or promoting, but not from aborting", async () => {
    const id = await create();
    await controlRelease(getDb(), { id, control: "approve", actor: bob });
    await getDb().update(releases).set({ status: "rolling", weight: 10, stepLiveAt: new Date() }).where(eq(releases.id, id));
    await expect(controlRelease(getDb(), { id, control: "advance", actor: alice })).rejects.toMatchObject({ code: "forbidden" });
    await expect(controlRelease(getDb(), { id, control: "promote", actor: alice })).rejects.toMatchObject({ code: "forbidden" });
    expect((await controlRelease(getDb(), { id, control: "abort", actor: alice })).status).toBe("cancelled");
  });
});
