import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "@/lib/core/plans";
import { closeDb, getDb } from "@/lib/db/client";
import { releases, user } from "@/lib/db/schema";
import { nextReleaseNumber } from "@/lib/releases/keys";
import { insertApp, insertVersion, pgErrorCode, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

async function owner() {
  const [row] = await getDb()
    .insert(user)
    .values({ id: "u-owner", name: "Owner", email: "owner@example.test", role: "admin" })
    .returning();
  return row;
}

async function fixture() {
  const creator = await owner();
  const shop = await insertApp("shop");
  const v1 = await insertVersion(shop.id, "v1");
  const v2 = await insertVersion(shop.id, "v2");
  const v3 = await insertVersion(shop.id, "v3");
  const blog = await insertApp("blog");
  const blogV1 = await insertVersion(blog.id, "v1");
  const release = (overrides: Partial<typeof releases.$inferInsert> = {}) =>
    getDb()
      .insert(releases)
      .values({
        appId: shop.id,
        number: 1,
        fromVersionId: v1.id,
        candidateVersionId: v2.id,
        plan: PLANS.demo,
        status: "warming",
        createdByKind: "user",
        createdByUserId: creator.id,
        ...overrides,
      })
      .returning();
  return { shop, v1, v2, v3, blogV1, release };
}

describe("releases", () => {
  it("rejects a candidate version from another app", async () => {
    const f = await fixture();
    expect(await pgErrorCode(f.release({ candidateVersionId: f.blogV1.id }))).toBe("23503");
  });

  it("allows only one active release per app", async () => {
    const f = await fixture();
    await f.release();
    expect(await pgErrorCode(f.release({ number: 2, candidateVersionId: f.v3.id }))).toBe("23505");
  });

  it("allows a new release once the previous one finished", async () => {
    const f = await fixture();
    await f.release({ status: "rolled_back" });
    await expect(f.release({ number: 2, candidateVersionId: f.v3.id })).resolves.toHaveLength(1);
  });

  it("rejects releasing a version onto itself and out-of-range weights", async () => {
    const f = await fixture();
    expect(await pgErrorCode(f.release({ candidateVersionId: f.v1.id }))).toBe("23514");
    expect(await pgErrorCode(f.release({ weight: 101 }))).toBe("23514");
    expect(await pgErrorCode(f.release({ status: "exploded" as never }))).toBe("23514");
  });
});

describe("per-app key counters", () => {
  it("are gapless and unique under concurrency", async () => {
    const shop = await insertApp("shop");
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => getDb().transaction((tx) => nextReleaseNumber(tx, shop.id))),
    );
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("give the number back when the transaction rolls back", async () => {
    const shop = await insertApp("shop");
    await getDb()
      .transaction(async (tx) => {
        await nextReleaseNumber(tx, shop.id);
        throw new Error("abort");
      })
      .catch(() => undefined);
    expect(await getDb().transaction((tx) => nextReleaseNumber(tx, shop.id))).toBe(1);
  });
});
