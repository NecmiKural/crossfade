import { and, eq, inArray } from "drizzle-orm";
import { findApp, registerVersion, type AppRow, type VersionRow } from "@/lib/apps";
import { AppError } from "@/lib/core/errors";
import { requestHash } from "@/lib/core/idempotency";
import { releaseKey } from "@/lib/core/keys";
import { isAtLeastAsCautious, PLANS } from "@/lib/core/plans";
import { type Actor, type ActorRef, actorRef, can } from "@/lib/core/policy";
import { ReleaseRequest, type ReleaseRequestInput } from "@/lib/core/schemas";
import type { Db, Tx } from "@/lib/db/client";
import { apps, type ReleaseStatus, releases, versions } from "@/lib/db/schema";
import { appendEvent } from "@/lib/events";
import { nextReleaseNumber } from "@/lib/releases/keys";
import { publishSnapshot } from "@/lib/xds/publish";

export const ACTIVE_STATUSES: readonly ReleaseStatus[] = ["pending_approval", "warming", "rolling", "paused"];

type Creator = Extract<Actor, { kind: "user" | "apikey" }>;
export type CreateResult = Readonly<{ created: boolean; releaseId: string }>;

function parse(body: unknown): ReleaseRequestInput {
  const parsed = ReleaseRequest.safeParse(body);
  if (!parsed.success) throw new AppError("invalid_request", "invalid release request", parsed.error.issues);
  return parsed.data;
}

function constraintOf(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  return cause?.code === "23505" ? cause.constraint_name : undefined;
}

async function existingRelease(tx: Tx, id: string, hash: string, app: string): Promise<CreateResult | undefined> {
  const [row] = await tx.select({ requestHash: releases.requestHash, slug: apps.slug }).from(releases).innerJoin(apps, eq(apps.id, releases.appId)).where(eq(releases.id, id));
  if (!row) return undefined;
  if (row.requestHash === hash && row.slug === app) return { created: false, releaseId: id };
  throw new AppError("id_conflict", "a different release already uses this id");
}

/** Locks in ADR-0007 order: the app's active release, then the app row (as engine promotions do). */
async function lockApp(tx: Tx, app: AppRow): Promise<AppRow> {
  const [active] = await tx
    .select({ number: releases.number })
    .from(releases)
    .where(and(eq(releases.appId, app.id), inArray(releases.status, [...ACTIVE_STATUSES])))
    .for("update");
  if (active) throw new AppError("active_release", "the app already has a release in progress", { active: releaseKey(app.key, active.number) });
  const [locked] = await tx.select().from(apps).where(eq(apps.id, app.id)).for("no key update");
  return locked;
}

async function resolveCandidate(tx: Tx, app: AppRow, request: ReleaseRequestInput, actor: ActorRef): Promise<VersionRow> {
  const { name, host, port, healthPath } = request.candidate;
  const [existing] = await tx.select().from(versions).where(and(eq(versions.appId, app.id), eq(versions.name, name)));
  if (existing) {
    const differs = host !== undefined && (existing.host !== host || existing.port !== port || existing.healthPath !== healthPath);
    if (differs) throw new AppError("version_conflict", `version ${name} already exists with a different upstream`);
    return existing;
  }
  if (host === undefined || port === undefined) throw new AppError("unknown_version", `version ${name} is not registered; send host and port to register it`);
  return registerVersion(tx, { app: app.slug, name, host, port, healthPath }, actor);
}

async function insertRelease(tx: Tx, args: { id: string; app: AppRow; candidate: VersionRow; request: ReleaseRequestInput; hash: string; actor: Creator }) {
  const { app, candidate, request, actor } = args;
  if (!app.stableVersionId) throw new AppError("no_stable_version", "the app has no stable version to release from");
  if (candidate.id === app.stableVersionId) throw new AppError("candidate_is_stable", `${candidate.name} is already the stable version`);
  const planId = request.plan ?? app.defaultPlan;
  if (!isAtLeastAsCautious(planId, app.defaultPlan)) {
    throw new AppError("plan_not_allowed", `plan ${planId} is less cautious than the app default (${app.defaultPlan})`);
  }
  const number = await nextReleaseNumber(tx, app.id);
  await tx.insert(releases).values({
    id: args.id,
    appId: app.id,
    number,
    fromVersionId: app.stableVersionId,
    candidateVersionId: candidate.id,
    plan: PLANS[planId],
    status: "warming",
    notes: request.notes ?? null,
    requestHash: args.hash,
    createdByKind: actor.kind,
    createdByUserId: actor.kind === "user" ? actor.id : actor.ownerId,
    createdViaKeyId: actor.kind === "apikey" ? actor.id : null,
  });
  return { number, planId };
}

async function createInTx(tx: Tx, id: string, request: ReleaseRequestInput, hash: string, actor: Creator): Promise<CreateResult> {
  const replay = await existingRelease(tx, id, hash, request.app);
  if (replay) return replay;
  const found = await findApp(tx, request.app);
  if (!found) throw new AppError("unknown_app", `unknown app "${request.app}"`);
  const ref = actorRef(actor);
  const app = await lockApp(tx, found);
  const candidate = await resolveCandidate(tx, app, request, ref);
  const current = (await findApp(tx, app.slug)) ?? app;
  const { number, planId } = await insertRelease(tx, { id, app: current, candidate, request, hash, actor });
  const key = releaseKey(app.key, number);
  await appendEvent(tx, {
    actor: ref,
    appId: app.id,
    releaseId: id,
    type: "release.created",
    message: `${key} created: ${candidate.name} with the ${planId} plan`,
    data: { plan: planId, candidate: candidate.name, notes: request.notes ?? null },
  });
  const snapshot = await publishSnapshot(tx, { reason: `${key} created`, actor: ref });
  await tx.update(releases).set({ snapshotId: snapshot.id, publishedAt: new Date() }).where(eq(releases.id, id));
  return { created: true, releaseId: id };
}

/**
 * Idempotent release creation (OSB-style): the client picks the id; the same id and body returns the
 * existing release, a different body is a conflict. Authorization is checked before existence, so a key
 * scoped to other apps learns nothing about this one.
 */
export async function createRelease(db: Db, input: { id: string; body: unknown; actor: Creator }): Promise<CreateResult> {
  const request = parse(input.body);
  if (!can(input.actor, { type: "release.create", app: request.app })) throw new AppError("app_not_allowed", "not allowed for this app");
  const hash = requestHash(request);
  try {
    return await db.transaction((tx) => createInTx(tx, input.id, request, hash, input.actor));
  } catch (error) {
    const constraint = constraintOf(error);
    if (constraint === "releases_pkey" || constraint === "one_active_release_per_app") {
      // Two retries of the same request can race; whichever constraint fires first, the loser
      // reports what the winner created. Only a genuinely different release is a conflict.
      const replay = await db.transaction((tx) => existingRelease(tx, input.id, hash, request.app));
      if (replay) return replay;
      throw new AppError("active_release", "the app already has a release in progress");
    }
    throw error;
  }
}
