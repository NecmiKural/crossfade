import { eq } from "drizzle-orm";
import { AppError } from "@/lib/core/errors";
import type { Plan } from "@/lib/core/plans";
import { type Actor, actorRef, can } from "@/lib/core/policy";
import type { Db } from "@/lib/db/client";
import { apps, releases } from "@/lib/db/schema";
import { applyControl, type Control } from "@/lib/engine/actions";
import type { Baseline } from "@/lib/engine/types";
import { applyResult, type ReleaseRow } from "@/lib/releases/apply";

/**
 * A person presses a button on a release. The row is locked FOR UPDATE first, so the engine
 * (SKIP LOCKED) steps around it; then the same applyResult() path as the engine writes the change.
 */
export async function controlRelease(db: Db, input: { id: string; control: Control; actor: Actor }): Promise<ReleaseRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(releases).where(eq(releases.id, input.id)).for("update");
    if (!row) throw new AppError("not_found", "release not found");
    const [app] = await tx.select({ slug: apps.slug, requiresApproval: apps.requiresApproval }).from(apps).where(eq(apps.id, row.appId));
    const facts = { app: app.slug, createdBy: row.createdByUserId, requiresApproval: app.requiresApproval };
    const allowed =
      input.control === "approve"
        ? can(input.actor, { type: "release.approve", ...facts })
        : can(input.actor, { type: "release.control", control: input.control, ...facts });
    if (!allowed) throw new AppError("forbidden", `you may not ${input.control} this release`);
    const result = applyControl({ ...row, plan: row.plan as Plan, baseline: row.baseline as Baseline | null }, input.control);
    if ("error" in result) throw new AppError("invalid_state", result.error);
    return applyResult(tx, row, result, actorRef(input.actor));
  });
}
