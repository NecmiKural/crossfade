import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/core/policy";
import { closeDb, getDb } from "@/lib/db/client";
import { addUser, createScopedKey, listKeys, listUsers, revokeKey } from "@/lib/settings";
import { stubAuthEnv } from "./helpers/auth";
import { insertApp, resetDb } from "./helpers/db";
import { eq } from "drizzle-orm";
import { apikey, user } from "@/lib/db/schema";

const admin: Actor = { kind: "user", id: "u-admin", role: "admin", readOnly: false };
const alice: Actor = { kind: "user", id: "u-alice", role: "user", readOnly: false };

beforeEach(async () => {
  stubAuthEnv(vi.stubEnv);
  await resetDb();
  await getDb().insert(user).values([
    { id: "u-admin", name: "Admin", email: "admin@example.test", role: "admin" },
    { id: "u-alice", name: "Alice", email: "alice@example.test", role: "user" },
  ]);
  await insertApp("shop");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("settings", () => {
  it("lets admins add users and rejects short passwords and duplicates", async () => {
    await addUser(getDb(), admin, { name: "Bob", email: "bob@example.test", password: "correct-horse-battery" });
    expect((await listUsers(getDb())).map((u) => u.email)).toContain("bob@example.test");
    await expect(addUser(getDb(), admin, { name: "Eve", email: "eve@example.test", password: "short" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(addUser(getDb(), admin, { name: "Bob", email: "BOB@example.test", password: "correct-horse-battery" })).rejects.toMatchObject({ code: "email_taken" });
  });

  it("creates, lists and revokes scoped keys", async () => {
    const created = await createScopedKey(getDb(), admin, { name: "ci", apps: ["shop"] });
    expect(created.key.startsWith("cf_")).toBe(true);
    const [listed] = await listKeys(getDb());
    expect(listed).toMatchObject({ name: "ci", apps: ["shop"], enabled: true, owner: "admin@example.test" });
    await revokeKey(getDb(), admin, created.id);
    expect((await listKeys(getDb()))[0].enabled).toBe(false);
  });

  it("lists a key whose permissions are not valid JSON as scoped to no apps", async () => {
    const created = await createScopedKey(getDb(), admin, { name: "ci", apps: ["shop"] });
    await getDb().update(apikey).set({ permissions: "{not json" }).where(eq(apikey.id, created.id));
    expect((await listKeys(getDb()))[0]).toMatchObject({ name: "ci", apps: [] });
  });

  it("denies non-admins", async () => {
    await expect(addUser(getDb(), alice, { name: "Bob", email: "bob@example.test", password: "correct-horse-battery" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createScopedKey(getDb(), alice, { name: "ci", apps: ["shop"] })).rejects.toMatchObject({ code: "forbidden" });
    const created = await createScopedKey(getDb(), admin, { name: "ci", apps: ["shop"] });
    await expect(revokeKey(getDb(), alice, created.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});
