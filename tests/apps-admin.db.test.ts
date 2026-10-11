import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminCreateApp, adminRegisterVersion, listApps, revealTesterToken, rotateTesterToken, updateAppSettings } from "@/lib/apps-admin";
import type { Actor } from "@/lib/core/policy";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, events, snapshots } from "@/lib/db/schema";
import { resetDb } from "./helpers/db";

const admin: Actor = { kind: "user", id: "u-admin", role: "admin", readOnly: false };
const alice: Actor = { kind: "user", id: "u-alice", role: "user", readOnly: false };

beforeEach(async () => {
  vi.stubEnv("UPSTREAM_ALLOWLIST", "shop=shop-v1:3000,shop-v2:3000");
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const snapshotCount = async () => (await getDb().select().from(snapshots)).length;

describe("app administration", () => {
  it("lets admins create apps and register allowlisted versions, publishing each write", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    const before = await snapshotCount();
    await adminRegisterVersion(getDb(), admin, { app: "shop", name: "v1", host: "shop-v1", port: 3000 });
    expect(await snapshotCount()).toBe(before + 1);
    const [listed] = await listApps(getDb());
    expect(listed).toMatchObject({ slug: "shop", stableVersion: "v1", versionCount: 1 });
  });

  it("rejects upstreams outside the allowlist with a clear error", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    await expect(adminRegisterVersion(getDb(), admin, { app: "shop", name: "v9", host: "shop-v1", port: 9999 })).rejects.toMatchObject({
      code: "upstream_not_allowed",
    });
  });

  it("denies every change to non-admins", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    await expect(adminCreateApp(getDb(), alice, { slug: "blog", key: "BLOG", domain: "blog.localhost" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(adminRegisterVersion(getDb(), alice, { app: "shop", name: "v1", host: "shop-v1", port: 3000 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateAppSettings(getDb(), alice, "shop", { defaultPlan: "demo", sticky: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revealTesterToken(getDb(), alice, "shop")).rejects.toMatchObject({ code: "forbidden" });
    await expect(rotateTesterToken(getDb(), alice, "shop")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("audits token reveals and rotations, and rotation changes the token", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    const first = await revealTesterToken(getDb(), admin, "shop");
    await rotateTesterToken(getDb(), admin, "shop");
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(shop.testerToken).not.toBe(first);
    const types = (await getDb().select().from(events).orderBy(events.id)).map((e) => e.type);
    expect(types).toEqual(["app.created", "token.revealed", "token.rotated"]);
  });

  it("updates settings and records them", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    await updateAppSettings(getDb(), admin, "shop", { defaultPlan: "cautious", sticky: false });
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    expect(shop).toMatchObject({ defaultPlan: "cautious", sticky: false });
  });

  it("rejects an unknown plan as invalid_request", async () => {
    await adminCreateApp(getDb(), admin, { slug: "shop", key: "SHOP", domain: "localhost" });
    await expect(updateAppSettings(getDb(), admin, "shop", { defaultPlan: "yolo" as never, sticky: true })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
