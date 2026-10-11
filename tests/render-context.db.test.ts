import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "@/lib/core/plans";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, releases, user } from "@/lib/db/schema";
import { publishSnapshot } from "@/lib/xds/publish";
import { insertApp, insertVersion, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

const publish = () => getDb().transaction((tx) => publishSnapshot(tx, { reason: "test", actor: { kind: "system", id: null } }));
const clusterNames = (snap: { clusters: string }) => JSON.parse(snap.clusters).map((c: { name: string }) => c.name);

async function shopWithVersions() {
  await getDb().insert(user).values({ id: "u1", name: "U", email: "u@example.test" });
  const shop = await insertApp("shop", { domain: "localhost" });
  const [v1, v2, v3] = [await insertVersion(shop.id, "v1"), await insertVersion(shop.id, "v2"), await insertVersion(shop.id, "v3")];
  await getDb().update(apps).set({ stableVersionId: v1.id }).where(eq(apps.id, shop.id));
  const release = (candidateVersionId: string, overrides: Partial<typeof releases.$inferInsert> = {}) =>
    getDb()
      .insert(releases)
      .values({
        appId: shop.id,
        number: Math.floor(Math.random() * 1e6) + 1,
        fromVersionId: v1.id,
        candidateVersionId,
        plan: PLANS.demo,
        status: "warming",
        createdByKind: "user",
        createdByUserId: "u1",
        ...overrides,
      });
  return { shop, v1, v2, v3, release };
}

describe("render context from Postgres", () => {
  it("renders only the stable version when nothing is in flight", async () => {
    await shopWithVersions();
    expect(clusterNames(await publish())).toEqual(["shop--v1"]);
  });

  it("adds the candidate cluster and the tester route while warming", async () => {
    const f = await shopWithVersions();
    await f.release(f.v2.id);
    const snap = await publish();
    expect(clusterNames(snap)).toEqual(["shop--v1", "shop--v2"]);
    const routes = JSON.parse(snap.routes)[0].virtual_hosts[0].routes.map((r: { name: string }) => r.name);
    expect(routes).toEqual(["shop.tester", "shop"]);
  });

  it("keeps clusters of recently finished releases and prunes older ones", async () => {
    const f = await shopWithVersions();
    await f.release(f.v2.id, { status: "rolled_back", finishedAt: new Date(Date.now() - 5 * 60_000) });
    await f.release(f.v3.id, { status: "rolled_back", finishedAt: new Date(Date.now() - 15 * 60_000) });
    expect(clusterNames(await publish())).toEqual(["shop--v1", "shop--v2"]);
  });

  it("renders the weighted split while rolling", async () => {
    const f = await shopWithVersions();
    await f.release(f.v2.id, { status: "rolling", weight: 10 });
    const route = JSON.parse((await publish()).routes)[0].virtual_hosts[0].routes[0].route;
    expect(route.weighted_clusters.clusters).toEqual([
      { name: "shop--v1", weight: 90 },
      { name: "shop--v2", weight: 10 },
    ]);
  });
});
