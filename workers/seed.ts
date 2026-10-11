import { eq } from "drizzle-orm";
import { createApp, findApp, registerVersion } from "@/lib/apps";
import { closeDb, getDb } from "@/lib/db/client";
import { versions } from "@/lib/db/schema";
import { errorMessage, log } from "@/lib/log";
import type { ActorRef } from "@/lib/xds/publish";

const system: ActorRef = { kind: "system", id: "demo-seed" };
const SHOP_VERSIONS = ["v1", "v2", "v3"] as const;

/** Idempotent demo data: app "shop" on localhost with three versions; v1 becomes stable. */
async function main(): Promise<void> {
  await getDb().transaction(async (tx) => {
    const shop =
      (await findApp(tx, "shop")) ??
      (await createApp(tx, { slug: "shop", key: "SHOP", domain: "localhost", defaultPlan: "demo" }, system));
    const existing = new Set((await tx.select().from(versions).where(eq(versions.appId, shop.id))).map((v) => v.name));
    for (const name of SHOP_VERSIONS.filter((n) => !existing.has(n))) {
      await registerVersion(tx, { app: "shop", name, host: `shop-${name}`, port: 3000 }, system);
    }
  });
  log("info", "demo data seeded");
}

main()
  .catch((error: unknown) => {
    log("error", "seed failed", { error: errorMessage(error) });
    process.exitCode = 1;
  })
  .finally(closeDb);
