import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, versions } from "@/lib/db/schema";
import { insertApp, insertVersion, pgErrorCode, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

describe("catalog constraints", () => {
  it("lets an app point its stable version at one of its own versions", async () => {
    const shop = await insertApp("shop");
    const v1 = await insertVersion(shop.id, "v1");
    await getDb().update(apps).set({ stableVersionId: v1.id }).where(eq(apps.id, shop.id));
    const [row] = await getDb().select().from(apps).where(eq(apps.id, shop.id));
    expect(row.stableVersionId).toBe(v1.id);
  });

  it("rejects a stable version that belongs to another app (composite FK)", async () => {
    const shop = await insertApp("shop");
    const blog = await insertApp("blog");
    const blogV1 = await insertVersion(blog.id, "v1");
    const code = await pgErrorCode(
      getDb().update(apps).set({ stableVersionId: blogV1.id }).where(eq(apps.id, shop.id)),
    );
    expect(code).toBe(FK_VIOLATION);
  });

  it("rejects two apps on the same domain and path prefix", async () => {
    await insertApp("shop", { domain: "localhost" });
    expect(await pgErrorCode(insertApp("blog", { domain: "localhost" }))).toBe(UNIQUE_VIOLATION);
  });

  it("allows the same domain with different prefixes", async () => {
    await insertApp("shop", { domain: "localhost" });
    await expect(insertApp("blog", { domain: "localhost", pathPrefix: "/blog" })).resolves.toBeDefined();
  });

  it("rejects duplicate version names within an app", async () => {
    const shop = await insertApp("shop");
    await insertVersion(shop.id, "v1");
    expect(await pgErrorCode(insertVersion(shop.id, "v1"))).toBe(UNIQUE_VIOLATION);
  });

  it.each([
    ["slug with a double dash", () => insertApp("shop--x")],
    ["lowercase key", () => insertApp("shop", { key: "shop" })],
    ["path prefix with a trailing slash", () => insertApp("shop", { pathPrefix: "/api/" })],
    ["unknown default plan", () => insertApp("shop", { defaultPlan: "yolo" })],
    ["malformed tester token", () => insertApp("shop", { testerToken: "abc" })],
  ])("enforces CHECK: %s", async (_name, insert) => {
    expect(await pgErrorCode(insert())).toBe(CHECK_VIOLATION);
  });

  it("enforces the version port range and name format", async () => {
    const shop = await insertApp("shop");
    expect(await pgErrorCode(insertVersion(shop.id, "v1", { port: 70000 }))).toBe(CHECK_VIOLATION);
    expect(await pgErrorCode(insertVersion(shop.id, "V1"))).toBe(CHECK_VIOLATION);
  });

  it("deletes versions with their app", async () => {
    const shop = await insertApp("shop");
    await insertVersion(shop.id, "v1");
    await getDb().delete(apps).where(eq(apps.id, shop.id));
    expect(await getDb().select().from(versions)).toHaveLength(0);
  });
});
