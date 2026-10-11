import { eq } from "drizzle-orm";
import { releaseKey } from "@/lib/core/keys";
import type { ActorRef } from "@/lib/core/policy";
import type { Tx } from "@/lib/db/client";
import { apps, type ReleaseStatus, releases } from "@/lib/db/schema";
import { holdMessage } from "@/lib/engine/holds";
import type { DecideResult, EventDraft, ReleaseState } from "@/lib/engine/types";
import { appendEvent } from "@/lib/events";
import { openOrLinkIncident, resolveIncidents } from "@/lib/releases/incidents";
import { publishSnapshot } from "@/lib/xds/publish";

export type ReleaseRow = typeof releases.$inferSelect;

export const TERMINAL_STATUSES: readonly ReleaseStatus[] = ["promoted", "rolled_back", "cancelled"];


/** One event when a hold starts or changes reason, not one every tick. */
function holdEvents(before: ReleaseRow, after: ReleaseState): EventDraft[] {
  if (!after.holdReason || after.holdReason === before.holdReason) return [];
  const message = after.holdReason === "paused" ? "paused" : `holding: ${holdMessage(after.holdReason)}`;
  return [{ type: "engine.hold", message, data: { reason: after.holdReason, ...after.holdDetail } }];
}

/**
 * The single side-effect path for the engine and for people. The caller holds the release row
 * (FOR UPDATE); this locks the app row next, then incidents, and takes the snapshot lock last (ADR-0007).
 */
export async function applyResult(tx: Tx, release: ReleaseRow, result: DecideResult, actor: ActorRef): Promise<ReleaseRow> {
  const now = new Date();
  const [app] = await tx.select().from(apps).where(eq(apps.id, release.appId)).for("no key update");
  const next = result.release;
  const terminal = TERMINAL_STATUSES.includes(next.status);
  await tx
    .update(releases)
    .set({
      status: next.status,
      statusChangedAt: next.status !== release.status ? now : release.statusChangedAt,
      stepIndex: next.stepIndex,
      weight: next.weight,
      stepLiveAt: next.stepLiveAt,
      baseline: next.baseline,
      holdReason: next.holdReason,
      holdDetail: next.holdDetail,
      outcome: result.outcome ?? release.outcome,
      finishedAt: terminal ? now : null,
      updatedAt: now,
    })
    .where(eq(releases.id, release.id));
  for (const event of [...result.events, ...holdEvents(release, next)]) {
    await appendEvent(tx, { actor, appId: app.id, releaseId: release.id, ...event });
  }
  if (result.outcome?.kind === "promoted") {
    await tx.update(apps).set({ stableVersionId: release.candidateVersionId }).where(eq(apps.id, app.id));
    await resolveIncidents(tx, { app, release, actor });
  }
  if (result.outcome?.kind === "rolled_back") {
    await openOrLinkIncident(tx, { app, release, outcome: result.outcome, actor });
  }
  if (result.publish) {
    const reason = `${releaseKey(app.key, release.number)}: ${result.events[0]?.type ?? next.status}`;
    const snapshot = await publishSnapshot(tx, { reason, actor });
    await tx.update(releases).set({ snapshotId: snapshot.id, publishedAt: now }).where(eq(releases.id, release.id));
  }
  const [updated] = await tx.select().from(releases).where(eq(releases.id, release.id));
  return updated;
}
