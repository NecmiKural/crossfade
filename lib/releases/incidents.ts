import { and, eq } from "drizzle-orm";
import { incidentKey, releaseKey } from "@/lib/core/keys";
import type { ActorRef } from "@/lib/core/policy";
import type { Tx } from "@/lib/db/client";
import { type apps, incidents, versions } from "@/lib/db/schema";
import type { Outcome } from "@/lib/engine/types";
import { appendEvent } from "@/lib/events";
import type { ReleaseRow } from "@/lib/releases/apply";
import { nextIssueNumber } from "@/lib/releases/keys";

type AppRow = typeof apps.$inferSelect;

function titleFor(version: string, outcome: Outcome): string {
  const e = outcome.evidence as { errorRate?: number; n?: number };
  switch (outcome.reason) {
    case "error_budget":
      return `${version} rolled back: ${Math.round((e.errorRate ?? 0) * 100)}% errors (n=${e.n ?? 0})`;
    case "candidate_unhealthy":
      return `${version} rolled back: failed its health checks mid-rollout`;
    case "health_gate_timeout":
      return `${version} rolled back: never became healthy at the edge`;
    default:
      return `${version} rolled back`;
  }
}

/** Files a keyed incident for a rolled-back version, or links the release to the one already open. */
export async function openOrLinkIncident(tx: Tx, args: { app: AppRow; release: ReleaseRow; outcome: Outcome; actor: ActorRef }): Promise<void> {
  const { app, release, outcome, actor } = args;
  const key = releaseKey(app.key, release.number);
  const [open] = await tx
    .select()
    .from(incidents)
    .where(and(eq(incidents.appId, app.id), eq(incidents.versionId, release.candidateVersionId), eq(incidents.status, "open")))
    .for("update");
  if (open) {
    const message = `${incidentKey(app.key, open.number)} hit again by ${key}`;
    await appendEvent(tx, { actor, appId: app.id, releaseId: release.id, incidentId: open.id, type: "incident.linked", message });
    return;
  }
  const [version] = await tx.select({ name: versions.name }).from(versions).where(eq(versions.id, release.candidateVersionId));
  const number = await nextIssueNumber(tx, app.id);
  const [created] = await tx
    .insert(incidents)
    .values({
      appId: app.id,
      number,
      versionId: release.candidateVersionId,
      releaseId: release.id,
      title: titleFor(version?.name ?? "candidate", outcome),
      evidence: { reason: outcome.reason, ...outcome.evidence },
    })
    .returning();
  const message = `${incidentKey(app.key, number)} opened: ${created.title}`;
  await appendEvent(tx, { actor, appId: app.id, releaseId: release.id, incidentId: created.id, type: "incident.opened", message });
}

/** A promotion proves the app works again: every open incident of the app closes, citing the release. */
export async function resolveIncidents(tx: Tx, args: { app: AppRow; release: ReleaseRow; actor: ActorRef }): Promise<void> {
  const { app, release, actor } = args;
  const resolved = await tx
    .update(incidents)
    .set({ status: "resolved", resolvedByReleaseId: release.id, resolvedAt: new Date() })
    .where(and(eq(incidents.appId, app.id), eq(incidents.status, "open")))
    .returning();
  for (const incident of resolved) {
    const message = `${incidentKey(app.key, incident.number)} resolved by ${releaseKey(app.key, release.number)}`;
    await appendEvent(tx, { actor, appId: app.id, releaseId: release.id, incidentId: incident.id, type: "incident.resolved", message });
  }
}
