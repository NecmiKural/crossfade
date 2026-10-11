import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, registerVersion } from "@/lib/apps";
import { parseAllowlist } from "@/lib/core/allowlist";
import { closeDb, getDb, type Tx } from "@/lib/db/client";
import { apps, snapshots } from "@/lib/db/schema";
import type { ActorRef } from "@/lib/xds/publish";
import { resetDb } from "./helpers/db";

beforeEach(resetDb);
afterAll(closeDb);

const actor: ActorRef = { kind: "system", id: "test" };
const allowlist = parseAllowlist("shop=shop-v1:3000,shop-v2:3000;blog=blog-blue:8080");
const inTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => getDb().transaction(fn);

describe("catalog service", () => {
  it("makes the first registered version stable and publishes each change", async () => {
    await inTx(async (tx) => {
      await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost" }, actor);
      await registerVersion(tx, { app: "shop", name: "v1", host: "shop-v1", port: 3000 }, actor, allowlist);
      await registerVersion(tx, { app: "shop", name: "v2", host: "shop-v2", port: 3000 }, actor, allowlist);
    });
    const [shop] = await getDb().select().from(apps).where(eq(apps.slug, "shop"));
    const rows = await getDb().select().from(snapshots).orderBy(snapshots.id);
    const latestRoutes = JSON.parse(rows[rows.length - 1].routes);
    expect(shop.stableVersionId).not.toBeNull();
    expect(rows.length).toBe(3);
    expect(latestRoutes[0].virtual_hosts[0].routes[0].route.cluster).toBe("shop--v1");
  });

  it("rejects upstreams that are not on the app's allowlist entry", async () => {
    await inTx((tx) => createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost" }, actor));
    const attempt = (host: string, port: number) =>
      inTx((tx) => registerVersion(tx, { app: "shop", name: "vx", host, port }, actor, allowlist));
    await expect(attempt("blog-blue", 8080)).rejects.toMatchObject({ code: "upstream_not_allowed" });
    await expect(attempt("shop-v1", 9999)).rejects.toMatchObject({ code: "upstream_not_allowed" });
    await expect(attempt("127.0.0.1", 3000)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects unknown apps and invalid input", async () => {
    await expect(
      inTx((tx) => registerVersion(tx, { app: "nope", name: "v1", host: "shop-v1", port: 3000 }, actor, allowlist)),
    ).rejects.toMatchObject({ code: "unknown_app" });
    await expect(inTx((tx) => createApp(tx, { slug: "Bad Slug", key: "X", domain: "localhost" }, actor))).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
