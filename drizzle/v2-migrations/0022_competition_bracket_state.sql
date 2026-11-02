CREATE TABLE "competition_bracket_states" (
	"competition_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition_bracket_states" ADD CONSTRAINT "competition_bracket_states_competition_id_seasons_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "competition_bracket_states" ("competition_id", "data", "updated_at")
SELECT "id", "bracket_data"::jsonb, "updated_at"
FROM "seasons"
WHERE "bracket_data" IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  source_count bigint;
  state_count bigint;
BEGIN
  SELECT count(*) INTO source_count FROM "seasons" WHERE "bracket_data" IS NOT NULL;
  SELECT count(*) INTO state_count FROM "competition_bracket_states";
  IF source_count <> state_count THEN
    RAISE EXCEPTION 'competition bracket state backfill verification failed: expected %, got %', source_count, state_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "seasons" DROP COLUMN "bracket_data";
