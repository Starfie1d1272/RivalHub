-- Terminal competitive catalog migration: the rank ladder moves from
-- competitive_platform_seasons.rank_order to the platform-owned
-- competitive_platform_ranks table. Published event frozen contexts
-- (teamRegistrationConfig.competitiveProfile.rankOrder) are historical facts
-- and are never rewritten by this migration.
CREATE TABLE "competitive_platforms" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Backfill platform identity from existing season catalogue rows. Known
-- platforms get their product display name; unknown keys fall back to the
-- technical key until a super_admin renames them.
INSERT INTO "competitive_platforms" ("key", "display_name")
SELECT DISTINCT platform,
  CASE platform WHEN 'perfect_world' THEN '完美世界竞技平台' ELSE platform END
FROM "competitive_platform_seasons"
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Fail closed when the same platform carries conflicting non-empty season
-- rank orders: promoting one silently would rewrite long-term facts. The
-- operator must reconcile the catalogue first.
DO $$
DECLARE
  conflict_platform text;
BEGIN
  FOR conflict_platform IN
    SELECT platform
    FROM "competitive_platform_seasons"
    WHERE jsonb_array_length(to_jsonb(rank_order)) > 0
    GROUP BY platform
    HAVING COUNT(DISTINCT (to_jsonb(rank_order))::text) > 1
  LOOP
    RAISE EXCEPTION '竞技平台 % 的不同赛季存在互相冲突的段位顺序，已按 fail-closed 终止迁移；请先核对历史 season rank_order 并统一为唯一平台段位体系后再重放迁移。', conflict_platform;
  END LOOP;
END
$$;--> statement-breakpoint
CREATE TABLE "competitive_platform_ranks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_key" text NOT NULL,
	"rank_key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Promote the agreed season rank order into the platform ladder. rankKey and
-- label start identical; labels stay editable afterwards while rankKey keeps
-- existing competitive_rank_facts and frozen event contexts valid.
INSERT INTO "competitive_platform_ranks" ("platform_key", "rank_key", "label", "sort_order")
SELECT picked.platform, r.value, r.value, r.ordinality - 1
FROM (
  SELECT DISTINCT ON (s.platform) s.platform, s.rank_order AS order_json
  FROM "competitive_platform_seasons" s
  WHERE jsonb_array_length(to_jsonb(s.rank_order)) > 0
  ORDER BY s.platform, s.created_at, s.id
) picked
CROSS JOIN LATERAL jsonb_array_elements_text(picked.order_json::jsonb) WITH ORDINALITY AS r(value, ordinality);--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_platform_ranks_platform_rank_key_unique" ON "competitive_platform_ranks" USING btree ("platform_key","rank_key");--> statement-breakpoint
CREATE UNIQUE INDEX "competitive_platform_ranks_platform_sort_order_unique" ON "competitive_platform_ranks" USING btree ("platform_key","sort_order");--> statement-breakpoint
CREATE INDEX "competitive_platform_ranks_platform_order_idx" ON "competitive_platform_ranks" USING btree ("platform_key","sort_order");--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD CONSTRAINT "competitive_platform_ranks_platform_key_competitive_platforms_key_fk" FOREIGN KEY ("platform_key") REFERENCES "public"."competitive_platforms"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitive_platform_seasons" ADD CONSTRAINT "competitive_platform_seasons_platform_competitive_platforms_key_fk" FOREIGN KEY ("platform") REFERENCES "public"."competitive_platforms"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitive_platform_seasons" DROP COLUMN "rank_order";--> statement-breakpoint
ALTER TABLE "competitive_platforms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competitive_platform_ranks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON competitive_platforms, competitive_platform_ranks FROM anon, authenticated;
