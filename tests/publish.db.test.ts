import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, snapshots } from "@/lib/db/schema";
import { type ActorRef, publishSnapshot } from "@/lib/xds/publish";
import { insertApp, insertVersion, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

const system: ActorRef = { kind: "system", id: null };
const publish = (reason = "test") => getDb().transaction((tx) => publishSnapshot(tx, { reason, actor: system }));
const allSnapshots = () => getDb().select().from(snapshots).orderBy(snapshots.id);

async function shopWithStable(name = "v1") {
  const shop = await insertApp("shop", { domain: "localhost" });
  const version = await insertVersion(shop.id, name);
  await getDb().update(apps).set({ stableVersionId: version.id }).where(eq(apps.id, shop.id));
  return { shop, version };
}

describe("publishSnapshot", () => {
  it("stores rendered config and versions close to the current time", async () => {
    await shopWithStable();
    const before = Date.now();
    const snap = await publish();
    expect(snap.cdsVersion).toBeGreaterThanOrEqual(before - 1000);
    expect(JSON.parse(snap.clusters).map((c: { name: string }) => c.name)).toEqual(["shop--v1"]);
    expect(JSON.parse(snap.routes)[0].name).toBe("edge");
  });

  it("does not insert a row when nothing changed", async () => {
    await shopWithStable();
    const first = await publish();
    const second = await publish();
    expect(second.id).toBe(first.id);
    expect(await allSnapshots()).toHaveLength(1);
  });

  it("keeps the CDS version when only routes change", async () => {
    const { shop } = await shopWithStable();
    const first = await publish();
    await getDb().update(apps).set({ pathPrefix: "/shop" }).where(eq(apps.id, shop.id));
    const second = await publish();
    expect(second.cdsVersion).toBe(first.cdsVersion);
    expect(second.rdsVersion).toBeGreaterThan(first.rdsVersion);
  });

  it("serializes concurrent publishers so the newest snapshot includes every committed change", async () => {
    await Promise.all(
      ["alpha", "beta", "gamma"].map((slug) =>
        getDb().transaction(async (tx) => {
          await tx.insert(apps).values({ slug, key: slug.toUpperCase(), domain: `${slug}.localhost`, testerToken: "a".repeat(64) });
          await publishSnapshot(tx, { reason: slug, actor: system });
        }),
      ),
    );
    const rows = await allSnapshots();
    const [latest] = await getDb().select().from(snapshots).orderBy(desc(snapshots.id)).limit(1);
    const hosts = JSON.parse(latest.routes)[0].virtual_hosts.map((v: { name: string }) => v.name);
    expect(hosts).toEqual(["alpha.localhost", "beta.localhost", "gamma.localhost", "fallback"]);
    const rdsVersions = rows.map((r) => r.rdsVersion);
    expect([...rdsVersions].sort((a, b) => a - b)).toEqual(rdsVersions);
    expect(new Set(rdsVersions).size).toBe(rows.length);
  });

  it("only ever increases versions, even if a stored version is ahead of the clock", async () => {
    await shopWithStable();
    const first = await publish();
    const future = first.rdsVersion + 10 ** 9;
    await getDb().update(snapshots).set({ rdsVersion: future, cdsVersion: future });
    await insertApp("blog");
    const next = await publish();
    expect(next.rdsVersion).toBe(future + 1);
    expect(next.cdsVersion).toBe(future);
  });
});
