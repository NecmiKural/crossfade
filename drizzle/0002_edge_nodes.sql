CREATE TABLE "edge_nodes" (
	"node_id" text NOT NULL,
	"type" text NOT NULL,
	"acked_version" bigint,
	"served_version" bigint NOT NULL,
	"served_since" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"envoy_version" text,
	CONSTRAINT "edge_nodes_node_id_type_pk" PRIMARY KEY("node_id","type"),
	CONSTRAINT "edge_nodes_type" CHECK ("edge_nodes"."type" IN ('cds', 'rds'))
);
