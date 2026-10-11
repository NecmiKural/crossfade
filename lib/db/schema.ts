import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PlanId } from "@/lib/core/plans";
import { user } from "@/lib/db/auth-schema";

const SLUG_SQL = "^[a-z0-9]+(-[a-z0-9]+)*$";
// Mirrors lib/core/schemas.ts, so rows written outside the app still render to valid Envoy config.
const LABEL_SQL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN_SQL = `^${LABEL_SQL}(\\.${LABEL_SQL})*$`;
const HOSTNAME_SQL = `^[a-z]([a-z0-9-]{0,61}[a-z0-9])?(\\.${LABEL_SQL})*$`;
const HEALTH_PATH_SQL = "^/([A-Za-z0-9_~-][A-Za-z0-9._~-]*(/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*)?$";

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    key: text("key").notNull().unique(),
    domain: text("domain").notNull(),
    pathPrefix: text("path_prefix").notNull().default("/"),
    stableVersionId: uuid("stable_version_id"),
    defaultPlan: text("default_plan").$type<PlanId>().notNull().default("standard"),
    sticky: boolean("sticky").notNull().default(true),
    testerToken: text("tester_token").notNull(),
    releaseSeq: integer("release_seq").notNull().default(0),
    issueSeq: integer("issue_seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("apps_domain_path_prefix_unique").on(t.domain, t.pathPrefix),
    check("apps_slug_format", sql.raw(`slug ~ '${SLUG_SQL}' AND length(slug) <= 40`)),
    check("apps_key_format", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check("apps_domain_format", sql.raw(`domain ~ '${DOMAIN_SQL}' AND length(domain) <= 253`)),
    check("apps_path_prefix_format", sql`${t.pathPrefix} ~ '^/$|^(/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$'`),
    check("apps_default_plan", sql`${t.defaultPlan} IN ('demo', 'standard', 'cautious', 'manual')`),
    check("apps_tester_token_format", sql`${t.testerToken} ~ '^[0-9a-f]{64}$'`),
    // The stable version must belong to this app (composite FK: tenant isolation in the schema).
    foreignKey({
      name: "apps_stable_version_fk",
      columns: [t.id, t.stableVersionId],
      foreignColumns: [versions.appId, versions.id],
    }),
  ],
);

export const versions = pgTable(
  "versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references((): AnyPgColumn => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    healthPath: text("health_path").notNull().default("/healthz"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("versions_app_name_unique").on(t.appId, t.name),
    unique("versions_app_id_unique").on(t.appId, t.id),
    check("versions_name_format", sql.raw(`name ~ '${SLUG_SQL}' AND length(name) <= 30`)),
    check("versions_port_range", sql`${t.port} BETWEEN 1 AND 65535`),
    check("versions_host_format", sql.raw(`host ~ '${HOSTNAME_SQL}' AND length(host) <= 253`)),
    check("versions_health_path_format", sql.raw(`health_path ~ '${HEALTH_PATH_SQL}' AND length(health_path) <= 200`)),
  ],
);

/**
 * Rendered Envoy config, one row per change. The JSON is stored as text so the xDS handler
 * serves exactly the bytes that were validated and hashed (Sovereign 1.0: render on write).
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    cdsVersion: bigint("cds_version", { mode: "number" }).notNull(),
    rdsVersion: bigint("rds_version", { mode: "number" }).notNull(),
    cdsHash: text("cds_hash").notNull(),
    rdsHash: text("rds_hash").notNull(),
    clusters: text("clusters").notNull(),
    routes: text("routes").notNull(),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("snapshots_actor_kind", sql`${t.actorKind} IN ('user', 'apikey', 'engine', 'system')`)],
);

/** What each Envoy node last polled per resource type; acked < served means "still applying". */
export const edgeNodes = pgTable(
  "edge_nodes",
  {
    nodeId: text("node_id").notNull(),
    type: text("type").notNull(),
    ackedVersion: bigint("acked_version", { mode: "number" }),
    servedVersion: bigint("served_version", { mode: "number" }).notNull(),
    servedSince: timestamp("served_since", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    envoyVersion: text("envoy_version"),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.type] }), check("edge_nodes_type", sql`${t.type} IN ('cds', 'rds')`)],
);

/** The audit trail: every decision, by a person, an API key, the engine or the system. */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    appId: uuid("app_id").references((): AnyPgColumn => apps.id, { onDelete: "cascade" }),
    // Foreign keys for these are added with their tables (releases, incidents).
    releaseId: uuid("release_id"),
    incidentId: uuid("incident_id"),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "events_release_fk", columns: [t.releaseId], foreignColumns: [releases.id] }).onDelete("cascade"),
    index("events_release_idx").on(t.releaseId, t.id),
    index("events_app_idx").on(t.appId, t.id),
    check("events_actor_kind", sql`${t.actorKind} IN ('user', 'apikey', 'engine', 'system')`),
  ],
);

export const RELEASE_STATUSES = ["pending_approval", "warming", "rolling", "paused", "promoted", "rolled_back", "cancelled"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
const ACTIVE_STATUSES_SQL = "'pending_approval', 'warming', 'rolling', 'paused'";

/** One attempt to move an app from one version to another. Shown as SHOP-R7 (number per app). */
export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references((): AnyPgColumn => apps.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    fromVersionId: uuid("from_version_id").notNull(),
    candidateVersionId: uuid("candidate_version_id").notNull(),
    /** A frozen copy of the plan, so later catalog changes never alter a running release. */
    plan: jsonb("plan").notNull(),
    status: text("status").$type<ReleaseStatus>().notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    stepIndex: integer("step_index").notNull().default(0),
    weight: integer("weight").notNull().default(0),
    snapshotId: bigint("snapshot_id", { mode: "number" }).references((): AnyPgColumn => snapshots.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    stepLiveAt: timestamp("step_live_at", { withTimezone: true }),
    baseline: jsonb("baseline"),
    holdReason: text("hold_reason"),
    holdDetail: jsonb("hold_detail"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    requestHash: text("request_hash"),
    createdByKind: text("created_by_kind").notNull(),
    /** The person behind the release: the signed-in user, or the owner of the API key. */
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references((): AnyPgColumn => user.id),
    createdViaKeyId: text("created_via_key_id"),
    approvedBy: text("approved_by").references((): AnyPgColumn => user.id),
    outcome: jsonb("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    unique("releases_app_number_unique").on(t.appId, t.number),
    // Both versions must belong to the release's app (tenant isolation in the schema).
    foreignKey({ name: "releases_from_version_fk", columns: [t.appId, t.fromVersionId], foreignColumns: [versions.appId, versions.id] }),
    foreignKey({ name: "releases_candidate_version_fk", columns: [t.appId, t.candidateVersionId], foreignColumns: [versions.appId, versions.id] }),
    check("releases_distinct_versions", sql`${t.fromVersionId} <> ${t.candidateVersionId}`),
    check("releases_status", sql.raw(`status IN (${RELEASE_STATUSES.map((s) => `'${s}'`).join(", ")})`)),
    check("releases_weight_range", sql`${t.weight} BETWEEN 0 AND 100`),
    check("releases_notes_length", sql`${t.notes} IS NULL OR length(${t.notes}) <= 2000`),
    check("releases_created_by_kind", sql`${t.createdByKind} IN ('user', 'apikey')`),
    uniqueIndex("one_active_release_per_app").on(t.appId).where(sql.raw(`status IN (${ACTIVE_STATUSES_SQL})`)),
    index("releases_due_idx").on(t.status, t.nextCheckAt),
    index("releases_finished_idx").on(t.appId, t.finishedAt),
  ],
);

/** Per-tick counters the engine saw for a release (sparklines, evidence). */
export const releaseSamples = pgTable(
  "release_samples",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references((): AnyPgColumn => releases.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    stableCompleted: bigint("stable_completed", { mode: "number" }).notNull(),
    stableErrors: bigint("stable_errors", { mode: "number" }).notNull(),
    candidateCompleted: bigint("candidate_completed", { mode: "number" }).notNull(),
    candidateErrors: bigint("candidate_errors", { mode: "number" }).notNull(),
    candidateHealthy: integer("candidate_healthy").notNull(),
  },
  (t) => [index("release_samples_release_idx").on(t.releaseId, t.at)],
);

/** Liveness of background workers (the engine), shown on the console and /api/health. */
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

// Better Auth tables (generated by `npx auth generate`, see auth.cli.ts).
export * from "@/lib/db/auth-schema";
