import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/setup/route";
import { getAuth } from "@/lib/auth";
import { closeDb, getDb } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { resetDb } from "./helpers/db";

const TOKEN = "setup-token-for-tests";

beforeEach(async () => {
  vi.stubEnv("SETUP_TOKEN", TOKEN);
  vi.stubEnv("BETTER_AUTH_SECRET", "a".repeat(64));
  vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

function setup(body: Record<string, unknown>, host = "127.0.0.1:3000") {
  return POST(
    new Request("http://127.0.0.1:3000/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify(body),
    }),
  );
}

const owner = { token: TOKEN, name: "Owner", email: "owner@example.test", password: "correct-horse-battery" };

describe("POST /api/setup", () => {
  it("creates the first account as admin, exactly once", async () => {
    const first = await setup(owner);
    expect(first.status).toBe(201);
    const rows = await getDb().select().from(user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "owner@example.test", role: "admin" });

    const second = await setup({ ...owner, email: "second@example.test" });
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ error: "setup_complete" });
  });

  it("lets the new owner sign in with the password", async () => {
    await setup(owner);
    const res = await getAuth().api.signInEmail({ body: { email: owner.email, password: owner.password }, asResponse: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/session_token/);
  });

  it("rejects a wrong token, a short password and a foreign Host", async () => {
    expect((await setup({ ...owner, token: "nope" })).status).toBe(401);
    expect((await setup({ ...owner, password: "short" })).status).toBe(400);
    expect((await setup(owner, "evil.example")).status).toBe(400);
    expect(await getDb().select().from(user)).toHaveLength(0);
  });

  it("serializes concurrent setup attempts", async () => {
    const results = await Promise.all(
      ["a", "b", "c"].map((n) => setup({ ...owner, email: `${n}@example.test` }).then((r) => r.status)),
    );
    expect(results.sort()).toEqual([201, 403, 403]);
  });

  it("keeps public sign-up disabled", async () => {
    const res = await getAuth().api.signUpEmail({
      body: { name: "Mallory", email: "m@example.test", password: "correct-horse-battery" },
      asResponse: true,
    });
    expect(res.status).toBe(400);
  });
});
