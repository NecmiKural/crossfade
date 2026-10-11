CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"version_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"resolved_by_release_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_app_number_unique" UNIQUE("app_id","number"),
	CONSTRAINT "incidents_status" CHECK ("incidents"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_release_id_releases_id_fk" FOREIGN KEY ("resolved_by_release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_version_fk" FOREIGN KEY ("app_id","version_id") REFERENCES "public"."versions"("app_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_incident_per_version" ON "incidents" USING btree ("app_id","version_id") WHERE status = 'open';--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_incident_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;