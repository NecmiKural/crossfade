import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as setupPost } from "@/app/api/setup/route";
import { getAuth } from "@/lib/auth";
import { closeDb } from "@/lib/db/client";
import { cookieHeader, DASHBOARD, signedInUser, stubAuthEnv } from "./helpers/auth";
import { resetDb } from "./helpers/db";

beforeEach(async () => {
  stubAuthEnv(vi.stubEnv);
  vi.stubEnv("SETUP_TOKEN", "t");
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

const post = (path: string, cookie: string, body: unknown = {}) =>
  authPost(
    new Request(`${DASHBOARD}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: DASHBOARD },
      body: JSON.stringify(body),
    }),
  );

describe("/api/auth guard", () => {
  it("blocks Better Auth's own API key routes for everyone", async () => {
    const admin = await signedInUser("admin@example.test", "admin");
    expect((await post("/api-key/create", admin.cookie, { name: "x" })).status).toBe(404);
  });

  it("makes impersonated sessions read-only but lets the admin leave", async () => {
    const admin = await signedInUser("admin@example.test", "admin");
    const bob = await signedInUser("bob@example.test", "user");
    const res = await getAuth().api.impersonateUser({ body: { userId: bob.id }, headers: new Headers({ cookie: admin.cookie }), asResponse: true });
    const impersonated = cookieHeader(res);
    const update = await post("/update-user", impersonated, { name: "pwned" });
    expect(update.status).toBe(403);
    expect(await update.json()).toEqual({ error: "read_only_impersonation" });
    expect((await post("/admin/stop-impersonating", impersonated)).status).toBe(200);
  });

  it("leaves normal sessions alone", async () => {
    const bob = await signedInUser("bob@example.test", "user");
    expect((await post("/update-user", bob.cookie, { name: "Bob" })).status).toBe(200);
  });
});

describe("/api/setup body cap", () => {
  it("refuses bodies over 4 KB before parsing them", async () => {
    const res = await setupPost(
      new Request(`${DASHBOARD}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", host: "127.0.0.1:3000" },
        body: JSON.stringify({ token: "t", pad: "x".repeat(5000) }),
      }),
    );
    expect(res.status).toBe(413);
  });
});
