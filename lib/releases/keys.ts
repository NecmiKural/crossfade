import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db/client";
import { apps } from "@/lib/db/schema";

/**
 * Allocates the next per-app number inside the caller's transaction. The row lock serializes
 * allocations per app, and a rollback gives the number back, so keys stay gapless.
 */
async function bump(tx: Tx, appId: string, column: "releaseSeq" | "issueSeq"): Promise<number> {
  const target = column === "releaseSeq" ? apps.releaseSeq : apps.issueSeq;
  const [row] = await tx
    .update(apps)
    .set({ [column]: sql`${target} + 1` })
    .where(eq(apps.id, appId))
    .returning({ n: target });
  if (!row) throw new Error(`app ${appId} not found`);
  return row.n;
}

export const nextReleaseNumber = (tx: Tx, appId: string): Promise<number> => bump(tx, appId, "releaseSeq");
export const nextIssueNumber = (tx: Tx, appId: string): Promise<number> => bump(tx, appId, "issueSeq");
