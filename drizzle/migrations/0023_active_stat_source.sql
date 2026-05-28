ALTER TABLE "match_maps" ADD COLUMN "active_stat_source" "stat_source";--> statement-breakpoint
ALTER TABLE "match_player_stats" DROP CONSTRAINT "match_player_stats_map_id_perfect_name_unique";--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD CONSTRAINT "match_player_stats_map_id_perfect_name_source_unique" UNIQUE("map_id","perfect_name","source");
