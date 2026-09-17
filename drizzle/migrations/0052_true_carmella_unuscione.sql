-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
CREATE TYPE "public"."gameplay_steam_identity_status" AS ENUM('active', 'retired');--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
CREATE TABLE "user_gameplay_steam_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"steam64" text NOT NULL,
	"status" "gameplay_steam_identity_status" DEFAULT 'active' NOT NULL,
	"source_import_id" uuid,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"retired_by_user_id" uuid,
	"retired_at" timestamp with time zone,
	"retired_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_gameplay_steam_ids_steam64_shape_check" CHECK ("user_gameplay_steam_ids"."steam64" ~ '^[0-9]{17}$'),
	CONSTRAINT "user_gameplay_steam_ids_status_shape_check" CHECK (("user_gameplay_steam_ids"."status" = 'active' AND "user_gameplay_steam_ids"."retired_by_user_id" IS NULL AND "user_gameplay_steam_ids"."retired_at" IS NULL AND "user_gameplay_steam_ids"."retired_reason" IS NULL)
      OR ("user_gameplay_steam_ids"."status" = 'retired' AND "user_gameplay_steam_ids"."retired_by_user_id" IS NOT NULL AND "user_gameplay_steam_ids"."retired_at" IS NOT NULL AND "user_gameplay_steam_ids"."retired_reason" IS NOT NULL))
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
ALTER TABLE "user_gameplay_steam_ids" ADD CONSTRAINT "user_gameplay_steam_ids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
ALTER TABLE "user_gameplay_steam_ids" ADD CONSTRAINT "user_gameplay_steam_ids_source_import_id_match_demo_imports_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."match_demo_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
ALTER TABLE "user_gameplay_steam_ids" ADD CONSTRAINT "user_gameplay_steam_ids_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
ALTER TABLE "user_gameplay_steam_ids" ADD CONSTRAINT "user_gameplay_steam_ids_retired_by_user_id_users_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
CREATE UNIQUE INDEX "user_gameplay_steam_ids_active_steam64_unique" ON "user_gameplay_steam_ids" USING btree ("steam64") WHERE "user_gameplay_steam_ids"."status" = 'active';--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
CREATE INDEX "user_gameplay_steam_ids_user_id_idx" ON "user_gameplay_steam_ids" USING btree ("user_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new gameplay identity table is empty at creation
CREATE INDEX "user_gameplay_steam_ids_source_import_id_idx" ON "user_gameplay_steam_ids" USING btree ("source_import_id");
--> statement-breakpoint
-- Issue #658: gameplay Steam identity mappings are server-only facts.
REVOKE ALL PRIVILEGES ON TABLE "user_gameplay_steam_ids" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "user_gameplay_steam_ids" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT unnest(ARRAY['user_gameplay_steam_ids']::text[])
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication AS publication
      JOIN pg_publication_rel AS publication_relation
        ON publication_relation.prpubid = publication.oid
      JOIN pg_class AS table_object
        ON table_object.oid = publication_relation.prrelid
      JOIN pg_namespace AS table_schema
        ON table_schema.oid = table_object.relnamespace
      WHERE publication.pubname = 'supabase_realtime'
        AND table_schema.nspname = 'public'
        AND table_object.relname = table_name
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION %I DROP TABLE %I.%I',
        'supabase_realtime',
        'public',
        table_name
      );
    END IF;
  END LOOP;
END $$;
