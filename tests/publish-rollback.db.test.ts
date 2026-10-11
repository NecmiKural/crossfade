import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/lib/db/client";
import { apps, snapshots } from "@/lib/db/schema";
import { publishSnapshot, SnapshotValidationError } from "@/lib/xds/publish";
import { resetDb } from "./helpers/db";

vi.mock("@/lib/xds/validate", () => ({ validateSnapshot: () => ['route "x" references unknown cluster "x--y"'] }));

beforeEach(resetDb);
afterAll(closeDb);

it("rolls the whole change back when the rendered config is invalid", async () => {
  const change = getDb().transaction(async (tx) => {
    await tx.insert(apps).values({ slug: "shop", key: "SHOP", domain: "localhost", testerToken: "a".repeat(64) });
    await publishSnapshot(tx, { reason: "test", actor: { kind: "system", id: null } });
  });
  await expect(change).rejects.toBeInstanceOf(SnapshotValidationError);
  expect(await getDb().select().from(apps)).toHaveLength(0);
  expect(await getDb().select().from(snapshots)).toHaveLength(0);
});
