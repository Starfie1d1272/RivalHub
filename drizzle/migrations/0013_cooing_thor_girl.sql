ALTER TABLE "seasons" ALTER COLUMN "max_team_size" SET DEFAULT 9;--> statement-breakpoint
ALTER TABLE "team_applications" ADD COLUMN "join_token" text;--> statement-breakpoint
CREATE INDEX "audit_logs_season_id_created_at_idx" ON "audit_logs" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE INDEX "team_members_team_id_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_applications_join_token_unique" ON "team_applications" USING btree ("join_token");--> statement-breakpoint
CREATE INDEX "matches_season_status_scheduled_at_idx" ON "matches" USING btree ("season_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "matches_team_a_id_idx" ON "matches" USING btree ("team_a_id");--> statement-breakpoint
CREATE INDEX "matches_team_b_id_idx" ON "matches" USING btree ("team_b_id");--> statement-breakpoint
CREATE INDEX "match_player_stats_match_id_idx" ON "match_player_stats" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_player_stats_user_id_idx" ON "match_player_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_time_proposals_match_id_idx" ON "match_time_proposals" USING btree ("match_id");--> statement-breakpoint
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
