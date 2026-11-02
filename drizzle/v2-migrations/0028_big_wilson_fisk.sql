CREATE TYPE "public"."recruitment_intent_kind" AS ENUM('team_recruiting', 'player_lft');--> statement-breakpoint
CREATE TYPE "public"."recruitment_intent_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "recruitment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "recruitment_intent_kind" NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	"positions" "cs2_role"[] DEFAULT ARRAY[]::cs2_role[] NOT NULL,
	"target_season_id" uuid,
	"note" text,
	"status" "recruitment_intent_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recruitment_intents_owner_shape_check" CHECK (("recruitment_intents"."kind" = 'team_recruiting' AND "recruitment_intents"."team_id" IS NOT NULL AND "recruitment_intents"."user_id" IS NULL)
      OR ("recruitment_intents"."kind" = 'player_lft' AND "recruitment_intents"."user_id" IS NOT NULL AND "recruitment_intents"."team_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "recruitment_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recruitment_intent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recruitment_intents" ADD CONSTRAINT "recruitment_intents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_intents" ADD CONSTRAINT "recruitment_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_intents" ADD CONSTRAINT "recruitment_intents_target_season_id_seasons_id_fk" FOREIGN KEY ("target_season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_interests" ADD CONSTRAINT "recruitment_interests_recruitment_intent_id_recruitment_intents_id_fk" FOREIGN KEY ("recruitment_intent_id") REFERENCES "public"."recruitment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_interests" ADD CONSTRAINT "recruitment_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_intents_one_team_unique" ON "recruitment_intents" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_intents_one_user_unique" ON "recruitment_intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recruitment_intents_open_discovery_idx" ON "recruitment_intents" USING btree ("kind","status","expires_at","updated_at");--> statement-breakpoint
CREATE INDEX "recruitment_intents_target_season_idx" ON "recruitment_intents" USING btree ("target_season_id");--> statement-breakpoint
CREATE INDEX "recruitment_interests_intent_idx" ON "recruitment_interests" USING btree ("recruitment_intent_id");--> statement-breakpoint
CREATE INDEX "recruitment_interests_user_idx" ON "recruitment_interests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_interests_one_user_per_intent_unique" ON "recruitment_interests" USING btree ("recruitment_intent_id","user_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."close_recruitment_intents_for_deleted_target_season"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "recruitment_intents"
  SET "status" = 'closed', "updated_at" = now()
  WHERE "target_season_id" = OLD."id" AND "status" = 'open';
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "seasons_close_recruitment_on_delete" BEFORE DELETE ON "seasons" FOR EACH ROW EXECUTE FUNCTION "public"."close_recruitment_intents_for_deleted_target_season"();--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."close_recruitment_intents_for_deleted_target_season"() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
INSERT INTO "recruitment_intents" ("kind", "team_id", "positions", "status", "expires_at")
SELECT 'team_recruiting', "id", ARRAY[]::cs2_role[], 'open', now() + interval '30 days'
FROM "teams"
WHERE "recruiting" = true AND "status" = 'active';--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "recruiting";
--> statement-breakpoint
ALTER TABLE "recruitment_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recruitment_interests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "recruitment_intents", "recruitment_interests" FROM anon, authenticated;
