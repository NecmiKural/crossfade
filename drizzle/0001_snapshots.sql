CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cds_version" bigint NOT NULL,
	"rds_version" bigint NOT NULL,
	"cds_hash" text NOT NULL,
	"rds_hash" text NOT NULL,
	"clusters" text NOT NULL,
	"routes" text NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_actor_kind" CHECK ("snapshots"."actor_kind" IN ('user', 'apikey', 'engine', 'system'))
);
