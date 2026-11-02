CREATE TABLE "user_map_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"map_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_map_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- Backfill canonical map proficiency from the latest non-empty season registration.
INSERT INTO "user_map_preferences" ("user_id", "map_preferences")
SELECT DISTINCT ON ("user_id") "user_id", "map_preferences"
FROM "season_registrations"
WHERE "map_preferences" <> '[]'::jsonb
ORDER BY "user_id", "updated_at" DESC;