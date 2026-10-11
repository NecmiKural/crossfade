import { and, desc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { incidentKey, releaseKey } from "@/lib/core/keys";
import type { Plan } from "@/lib/core/plans";
import type { Db } from "@/lib/db/client";
import { apps, edgeNodes, incidents, type ReleaseStatus, releaseSamples, releases, snapshots, versions } from "@/lib/db/schema";

const TERMINAL: readonly ReleaseStatus[] = ["promoted", "rolled_back", "cancelled"];
export const LIVE_NODE_WINDOW_MS = 15_000;

export type Baseline = Readonly<{ at: string; stable: { completed: number; errors: number }; candidate: { completed: number; errors: number } }>;

export type ReleaseStatusView = Readonly<{
  id: string;
  key: string;
  app: string;
  from: string;
  candidate: string;
  plan: { id: string; steps: Plan["steps"] };
  status: ReleaseStatus;
  terminal: boolean;
  /** Every live Envoy node has acked the routes that carry this release's latest publish. */
  applied: boolean;
  step: { index: number; count: number; weight: number; phase: "applying" | "baking" | "holding" | null; bakeRemainingSeconds: number | null };
  hold: { reason: string; detail: unknown } | null;
  analysis: { n: number; errors: number; errorRate: number; minRequests: number; maxErrorRate: number };
  outcome: unknown;
  incident: { key: string; status: "open" | "resolved"; resolvedBy: string | null } | null;
  snapshot: { rev: number; rdsVersion: number } | null;
  createdBy: { kind: string; id: string | null };
  createdAt: string;
  finishedAt: string | null;
  links: { self: string; ui: string };
}>;

const fromVersion = alias(versions, "from_version");
const resolver = alias(releases, "resolver");

/** The incident a rolled-back release filed or was linked to (same app and candidate version). */
async function incidentFor(db: Db, release: typeof releases.$inferSelect, appKey: string): Promise<ReleaseStatusView["incident"]> {
  if (release.status !== "rolled_back") return null;
  const [row] = await db
    .select({ number: incidents.number, status: incidents.status, resolvedBy: resolver.number })
    .from(incidents)
    .leftJoin(resolver, eq(resolver.id, incidents.resolvedByReleaseId))
    .where(and(eq(incidents.appId, release.appId), eq(incidents.versionId, release.candidateVersionId)))
    .orderBy(desc(incidents.createdAt))
    .limit(1);
  if (!row) return null;
  return { key: incidentKey(appKey, row.number), status: row.status, resolvedBy: row.resolvedBy === null ? null : releaseKey(appKey, row.resolvedBy) };
}
const candidateVersion = alias(versions, "candidate_version");

/** Loads a release with what the status needs. Returns undefined for unknown ids. */
export async function releaseView(db: Db, id: string, now = new Date()): Promise<{ appSlug: string; view: ReleaseStatusView } | undefined> {
  const [row] = await db
    .select({ release: releases, app: apps, from: fromVersion.name, candidate: candidateVersion.name, rdsVersion: snapshots.rdsVersion })
    .from(releases)
    .innerJoin(apps, eq(apps.id, releases.appId))
    .innerJoin(fromVersion, eq(fromVersion.id, releases.fromVersionId))
    .innerJoin(candidateVersion, eq(candidateVersion.id, releases.candidateVersionId))
    .leftJoin(snapshots, eq(snapshots.id, releases.snapshotId))
    .where(eq(releases.id, id));
  if (!row) return undefined;
  const nodes = await db
    .select({ acked: edgeNodes.ackedVersion })
    .from(edgeNodes)
    .where(and(eq(edgeNodes.type, "rds"), gt(edgeNodes.lastSeenAt, new Date(now.getTime() - LIVE_NODE_WINDOW_MS))));
  const [sample] = await db.select().from(releaseSamples).where(eq(releaseSamples.releaseId, id)).orderBy(desc(releaseSamples.id)).limit(1);
  const applied = row.rdsVersion !== null && nodes.length > 0 && nodes.every((n) => (n.acked ?? -1) >= (row.rdsVersion ?? 0));
  const incident = await incidentFor(db, row.release, row.app.key);
  return { appSlug: row.app.slug, view: buildView({ ...row, applied, sample, incident, now }) };
}

type ViewInput = {
  release: typeof releases.$inferSelect;
  app: typeof apps.$inferSelect;
  from: string;
  candidate: string;
  rdsVersion: number | null;
  applied: boolean;
  sample: typeof releaseSamples.$inferSelect | undefined;
  incident: ReleaseStatusView["incident"];
  now: Date;
};

function analysisOf(plan: Plan, baseline: Baseline | null, sample: ViewInput["sample"]) {
  const n = baseline && sample ? Math.max(0, sample.candidateCompleted - baseline.candidate.completed) : 0;
  const errors = baseline && sample ? Math.max(0, sample.candidateErrors - baseline.candidate.errors) : 0;
  return { n, errors, errorRate: n > 0 ? errors / n : 0, minRequests: plan.minRequests, maxErrorRate: plan.maxErrorRate };
}

function stepOf(r: ViewInput["release"], plan: Plan, now: Date): ReleaseStatusView["step"] {
  const terminal = TERMINAL.includes(r.status);
  const phase = terminal ? null : r.holdReason ? "holding" : r.stepLiveAt ? "baking" : r.publishedAt ? "applying" : null;
  const bake = plan.steps[r.stepIndex]?.bakeSeconds ?? 0;
  const remaining = r.stepLiveAt && r.status === "rolling" ? Math.max(0, Math.ceil(bake - (now.getTime() - r.stepLiveAt.getTime()) / 1000)) : null;
  return { index: r.stepIndex, count: plan.steps.length, weight: r.weight, phase, bakeRemainingSeconds: remaining };
}

export function buildView(input: ViewInput): ReleaseStatusView {
  const r = input.release;
  const plan = r.plan as Plan;
  return {
    id: r.id,
    key: releaseKey(input.app.key, r.number),
    app: input.app.slug,
    from: input.from,
    candidate: input.candidate,
    plan: { id: plan.id, steps: plan.steps },
    status: r.status,
    terminal: TERMINAL.includes(r.status),
    applied: input.applied,
    step: stepOf(r, plan, input.now),
    hold: r.holdReason ? { reason: r.holdReason, detail: r.holdDetail } : null,
    analysis: analysisOf(plan, r.baseline as Baseline | null, input.sample),
    outcome: r.outcome ?? null,
    incident: input.incident,
    snapshot: r.snapshotId !== null && input.rdsVersion !== null ? { rev: r.snapshotId, rdsVersion: input.rdsVersion } : null,
    createdBy: { kind: r.createdByKind, id: r.createdByKind === "apikey" ? r.createdViaKeyId : r.createdByUserId },
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    links: { self: `/api/v1/releases/${r.id}`, ui: `/releases/${r.id}` },
  };
}
