import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { getAuth } from "@/lib/auth";
import { actorFromRequest } from "@/lib/dal";
import { closeDb } from "@/lib/db/client";
import { banUser, cookieHeader, DASHBOARD, signedInUser, stubAuthEnv } from "./helpers/auth";
import { insertApp, resetDb } from "./helpers/db";

beforeEach(async () => {
  stubAuthEnv(vi.stubEnv);
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const keyRequest = (cookie: string, body: unknown, origin = DASHBOARD) =>
  createKey(
    new Request(`${DASHBOARD}/api/v1/keys`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify(body),
    }),
  );

const withKey = (key: string) => new Request(`${DASHBOARD}/api/v1/releases/x`, { headers: { "x-api-key": key } });

async function adminKey(apps: string[] = ["shop"]) {
  await insertApp("shop");
  await insertApp("blog");
  const admin = await signedInUser("admin@example.test", "admin");
  const res = await keyRequest(admin.cookie, { name: "ci", apps });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; key: string; apps: string[] };
  return { admin, ...body };
}

describe("API keys", () => {
  it("are created by admins, prefixed, and scoped to the requested apps", async () => {
    const { key, apps, admin } = await adminKey(["shop"]);
    expect(key.startsWith("cf_")).toBe(true);
    expect(apps).toEqual(["shop"]);
    const caller = await actorFromRequest(withKey(key));
    expect(caller).toMatchObject({ ok: true, actor: { kind: "apikey", ownerId: admin.id, apps: ["shop"] } });
  });

  it("stay valid for 100 consecutive verifications (no plugin rate limit)", async () => {
    const { key } = await adminKey();
    for (let i = 0; i < 100; i++) {
      const caller = await actorFromRequest(withKey(key));
      expect(caller.ok, `verification ${i + 1}`).toBe(true);
    }
  });

  it("stop working when revoked", async () => {
    const { key, id, admin } = await adminKey();
    await getAuth().api.updateApiKey({ body: { keyId: id, userId: admin.id, enabled: false } });
    expect(await actorFromRequest(withKey(key))).toMatchObject({ ok: false, status: 401 });
  });

  it("are refused when the owner is banned", async () => {
    const { key, admin } = await adminKey();
    await banUser(admin.id);
    expect(await actorFromRequest(withKey(key))).toMatchObject({ ok: false, status: 401, error: "key_owner_inactive" });
  });

  it("reject unknown keys", async () => {
    expect(await actorFromRequest(withKey("cf_nope"))).toMatchObject({ ok: false, status: 401 });
  });

  it("cannot be created by non-admins, from another origin, or for unknown apps", async () => {
    await insertApp("shop");
    const alice = await signedInUser("alice@example.test", "user");
    expect((await keyRequest(alice.cookie, { name: "ci", apps: ["shop"] })).status).toBe(403);
    const admin = await signedInUser("admin@example.test", "admin");
    expect((await keyRequest(admin.cookie, { name: "ci", apps: ["shop"] }, "http://evil.example")).status).toBe(403);
    expect((await keyRequest(admin.cookie, { name: "ci", apps: ["nope"] })).status).toBe(422);
    expect((await keyRequest("", { name: "ci", apps: ["shop"] })).status).toBe(401);
  });

  it("resolves impersonated sessions as read-only users", async () => {
    const admin = await signedInUser("admin@example.test", "admin");
    const bob = await signedInUser("bob@example.test", "user");
    const res = await getAuth().api.impersonateUser({
      body: { userId: bob.id },
      headers: new Headers({ cookie: admin.cookie }),
      asResponse: true,
    });
    const caller = await actorFromRequest(new Request(DASHBOARD, { headers: { cookie: cookieHeader(res) } }));
    expect(caller).toMatchObject({ ok: true, actor: { kind: "user", id: bob.id, readOnly: true } });
  });
});
