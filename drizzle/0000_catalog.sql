CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"key" text NOT NULL,
	"domain" text NOT NULL,
	"path_prefix" text DEFAULT '/' NOT NULL,
	"stable_version_id" uuid,
	"default_plan" text DEFAULT 'standard' NOT NULL,
	"sticky" boolean DEFAULT true NOT NULL,
	"tester_token" text NOT NULL,
	"release_seq" integer DEFAULT 0 NOT NULL,
	"issue_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_slug_unique" UNIQUE("slug"),
	CONSTRAINT "apps_key_unique" UNIQUE("key"),
	CONSTRAINT "apps_domain_path_prefix_unique" UNIQUE("domain","path_prefix"),
	CONSTRAINT "apps_slug_format" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 40),
	CONSTRAINT "apps_key_format" CHECK ("apps"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "apps_path_prefix_format" CHECK ("apps"."path_prefix" ~ '^/$|^(/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$'),
	CONSTRAINT "apps_default_plan" CHECK ("apps"."default_plan" IN ('demo', 'standard', 'cautious', 'manual')),
	CONSTRAINT "apps_tester_token_format" CHECK ("apps"."tester_token" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"health_path" text DEFAULT '/healthz' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_app_name_unique" UNIQUE("app_id","name"),
	CONSTRAINT "versions_app_id_unique" UNIQUE("app_id","id"),
	CONSTRAINT "versions_name_format" CHECK (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(name) <= 30),
	CONSTRAINT "versions_port_range" CHECK ("versions"."port" BETWEEN 1 AND 65535)
);
--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_stable_version_fk" FOREIGN KEY ("id","stable_version_id") REFERENCES "public"."versions"("app_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;