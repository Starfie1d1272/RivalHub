CREATE TYPE "public"."stat_source" AS ENUM('manual_ocr', 'demo_import');--> statement-breakpoint
ALTER TABLE "match_player_stats" ADD COLUMN "source" "stat_source" DEFAULT 'manual_ocr' NOT NULL;
