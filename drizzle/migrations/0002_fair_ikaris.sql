ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_season_id_registration_id_unique" UNIQUE("season_id","registration_id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_registration_id_unique" UNIQUE("registration_id");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_draft_order_unique" UNIQUE("season_id","draft_order");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_teams_different" CHECK ("matches"."team_a_id" != "matches"."team_b_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_score_a_nonneg" CHECK ("matches"."score_a" IS NULL OR "matches"."score_a" >= 0);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_score_b_nonneg" CHECK ("matches"."score_b" IS NULL OR "matches"."score_b" >= 0);--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_order_range" CHECK ("match_maps"."map_order" >= 1 AND "match_maps"."map_order" <= 5);--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_score_a_nonneg" CHECK ("match_maps"."score_a" IS NULL OR "match_maps"."score_a" >= 0);--> statement-breakpoint
ALTER TABLE "match_maps" ADD CONSTRAINT "match_maps_score_b_nonneg" CHECK ("match_maps"."score_b" IS NULL OR "match_maps"."score_b" >= 0);