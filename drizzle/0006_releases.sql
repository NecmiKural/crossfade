CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"stable_completed" bigint NOT NULL,
	"stable_errors" bigint NOT NULL,
	"candidate_completed" bigint NOT NULL,
	"candidate_errors" bigint NOT NULL,
	"candidate_healthy" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"from_version_id" uuid NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"status" text NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"snapshot_id" bigint,
	"published_at" timestamp with time zone,
	"step_live_at" timestamp with time zone,
	"baseline" jsonb,
	"hold_reason" text,
	"hold_detail" jsonb,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"request_hash" text,
	"created_by_kind" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_via_key_id" text,
	"approved_by" text,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "releases_app_number_unique" UNIQUE("app_id","number"),
	CONSTRAINT "releases_distinct_versions" CHECK ("releases"."from_version_id" <> "releases"."candidate_version_id"),
	CONSTRAINT "releases_status" CHECK (status IN ('pending_approval', 'warming', 'rolling', 'paused', 'promoted', 'rolled_back', 'cancelled')),
	CONSTRAINT "releases_weight_range" CHECK ("releases"."weight" BETWEEN 0 AND 100),
	CONSTRAINT "releases_notes_length" CHECK ("releases"."notes" IS NULL OR length("releases"."notes") <= 2000),
	CONSTRAINT "releases_created_by_kind" CHECK ("releases"."created_by_kind" IN ('user', 'apikey'))
);
--> statement-breakpoint
ALTER TABLE "release_samples" ADD CONSTRAINT "release_samples_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_from_version_fk" FOREIGN KEY ("app_id","from_version_id") REFERENCES "public"."versions"("app_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_candidate_version_fk" FOREIGN KEY ("app_id","candidate_version_id") REFERENCES "public"."versions"("app_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_samples_release_idx" ON "release_samples" USING btree ("release_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_release_per_app" ON "releases" USING btree ("app_id") WHERE status IN ('pending_approval', 'warming', 'rolling', 'paused');--> statement-breakpoint
CREATE INDEX "releases_due_idx" ON "releases" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "releases_finished_idx" ON "releases" USING btree ("app_id","finished_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_release_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;