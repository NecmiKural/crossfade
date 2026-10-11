import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const SLUG_SQL = "^[a-z0-9]+(-[a-z0-9]+)*$";

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    key: text("key").notNull().unique(),
    domain: text("domain").notNull(),
    pathPrefix: text("path_prefix").notNull().default("/"),
    stableVersionId: uuid("stable_version_id"),
    defaultPlan: text("default_plan").notNull().default("standard"),
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
