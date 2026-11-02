ALTER TABLE "competitive_platform_seasons" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitive_platform_seasons" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_platform_seasons_one_current_per_platform" ON "competitive_platform_seasons" USING btree ("platform") WHERE "competitive_platform_seasons"."is_current";--> statement-breakpoint
CREATE INDEX "competitive_platform_seasons_platform_order_idx" ON "competitive_platform_seasons" USING btree ("platform","sort_order");