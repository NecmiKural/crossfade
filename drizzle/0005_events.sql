CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"app_id" uuid,
	"release_id" uuid,
	"incident_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_actor_kind" CHECK ("events"."actor_kind" IN ('user', 'apikey', 'engine', 'system'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_release_idx" ON "events" USING btree ("release_id","id");--> statement-breakpoint
CREATE INDEX "events_app_idx" ON "events" USING btree ("app_id","id");