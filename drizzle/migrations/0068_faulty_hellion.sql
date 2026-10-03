CREATE TABLE "statistics_projection_repair_cursors" (
	"projection_version" text PRIMARY KEY NOT NULL,
	"after_map_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "statistics_projection_repair_cursors" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "statistics_projection_repair_cursors" ENABLE ROW LEVEL SECURITY;
