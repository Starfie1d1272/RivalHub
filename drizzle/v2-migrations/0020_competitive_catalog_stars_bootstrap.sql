ALTER TABLE "competitive_platform_ranks" ADD COLUMN "star_min" integer;--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD COLUMN "star_max" integer;--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD COLUMN "stars" integer;--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD CONSTRAINT "competitive_platform_ranks_star_range_shape" CHECK (("competitive_platform_ranks"."star_min" IS NULL AND "competitive_platform_ranks"."star_max" IS NULL) OR "competitive_platform_ranks"."star_min" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD CONSTRAINT "competitive_platform_ranks_star_min_non_negative" CHECK ("competitive_platform_ranks"."star_min" IS NULL OR "competitive_platform_ranks"."star_min" >= 0);--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD CONSTRAINT "competitive_platform_ranks_star_max_non_negative" CHECK ("competitive_platform_ranks"."star_max" IS NULL OR "competitive_platform_ranks"."star_max" >= 0);--> statement-breakpoint
ALTER TABLE "competitive_platform_ranks" ADD CONSTRAINT "competitive_platform_ranks_star_range_ordered" CHECK ("competitive_platform_ranks"."star_max" IS NULL OR "competitive_platform_ranks"."star_max" >= "competitive_platform_ranks"."star_min");--> statement-breakpoint
ALTER TABLE "competitive_rank_facts" ADD CONSTRAINT "competitive_rank_facts_stars_non_negative" CHECK ("competitive_rank_facts"."stars" IS NULL OR "competitive_rank_facts"."stars" >= 0);--> statement-breakpoint
-- 2.0 ships two product-defined catalog identities. Every reconciliation
-- check runs BEFORE any mutation so a conflicting operator row fails closed
-- and leaves the catalog byte-for-byte unchanged.
DO $$
DECLARE
  expected_sort_order integer;
BEGIN
  -- 2.0 ships exactly two built-in identities; an unknown third platform must
  -- be reconciled explicitly. The migration neither deletes nor guesses.
  IF EXISTS (SELECT 1 FROM "competitive_platforms" WHERE "key" NOT IN ('perfect_world', 'fivee')) THEN
    RAISE EXCEPTION '发现未知竞技平台 identity；2.0 只支持已确认内置平台（perfect_world / fivee），迁移不删除也不猜测，请先明确 reconcile 后再重放迁移。';
  END IF;
  IF EXISTS (SELECT 1 FROM "competitive_platforms" WHERE "key" = 'perfect_world' AND "rating_label" <> 'Rating Pro') THEN
    RAISE EXCEPTION 'perfect_world 的 canonical Rating 与 Rating Pro 冲突；请先明确 reconcile 后再重放迁移。';
  END IF;
  IF EXISTS (SELECT 1 FROM "competitive_platforms" WHERE "key" = 'fivee' AND "rating_label" <> 'Rating+') THEN
    RAISE EXCEPTION 'fivee 的 canonical Rating 与 Rating+ 冲突；请先明确 reconcile 后再重放迁移。';
  END IF;
  -- Perfect 现实页面同时存在 S23/S24 连续编号与 2026S1/S2 年度编号，且可能指同一赛季。
  -- seasonKey 是 #291 之后的 immutable identity：迁移不猜测别名关系，也不创建重复赛季。
  IF EXISTS (SELECT 1 FROM "competitive_platform_seasons" WHERE "platform" = 'perfect_world') THEN
    RAISE EXCEPTION 'perfect_world 已存在赛季目录（可能包含 S23/S24 命名）；不能猜测它与 2026S1/S2 的别名关系，也不能创建 alias duplicate season。请先明确 reconcile 后再重放迁移。';
  END IF;
  IF EXISTS (SELECT 1 FROM "competitive_platform_seasons" WHERE "platform" = 'fivee') THEN
    RAISE EXCEPTION 'fivee 已存在赛季目录；请先明确 reconcile 后再重放迁移。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "competitive_platform_ranks"
    WHERE "platform_key" = 'perfect_world'
      AND "rank_key" NOT IN ('D','C','C+','C++','B','B+','B++','A','A+','A++','青铜S','黄金S','钻石S','魔王S')
  ) THEN
    RAISE EXCEPTION 'perfect_world 存在非 2.0 已确认 ladder 的 rankKey；请先明确 reconcile 后再重放迁移。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "competitive_platform_ranks"
    WHERE "platform_key" = 'fivee'
      AND "rank_key" NOT IN ('D','C','C+','C++','B','B+','B++','A','A+','A++','S','SS','SSS')
  ) THEN
    RAISE EXCEPTION 'fivee 存在非 2.0 已确认 ladder 的 rankKey；请先明确 reconcile 后再重放迁移。';
  END IF;
  -- Existing referenced rankKeys keep their ladder position; a divergent
  -- sort_order means the operator ladder is not the product ladder.
  FOR expected_sort_order IN
    SELECT r.sort_order
    FROM "competitive_platform_ranks" r
    JOIN (VALUES
      ('perfect_world','D',0),('perfect_world','C',1),('perfect_world','C+',2),('perfect_world','C++',3),('perfect_world','B',4),('perfect_world','B+',5),('perfect_world','B++',6),('perfect_world','A',7),('perfect_world','A+',8),('perfect_world','A++',9),('perfect_world','青铜S',10),('perfect_world','黄金S',11),('perfect_world','钻石S',12),('perfect_world','魔王S',13),
      ('fivee','D',0),('fivee','C',1),('fivee','C+',2),('fivee','C++',3),('fivee','B',4),('fivee','B+',5),('fivee','B++',6),('fivee','A',7),('fivee','A+',8),('fivee','A++',9),('fivee','S',10),('fivee','SS',11),('fivee','SSS',12)
    ) AS expected(platform_key, rank_key, sort_order)
      ON expected.platform_key = r.platform_key AND expected.rank_key = r.rank_key
    WHERE r.sort_order <> expected.sort_order
    LIMIT 1
  LOOP
    RAISE EXCEPTION '已有 rankKey 的 sortOrder 与 2.0 已确认 ladder 冲突；请先明确 reconcile 后再重放迁移。';
  END LOOP;
END
$$;--> statement-breakpoint
INSERT INTO "competitive_platforms" ("key", "display_name", "rating_label") VALUES
  ('perfect_world', '完美世界竞技平台', 'Rating Pro'),
  ('fivee', '5E', 'Rating+')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Star bounds are the only rank attribute this bootstrap fills; operator
-- display labels and sort orders of existing ranks stay untouched.
WITH expected (platform_key, rank_key, label, sort_order, star_min, star_max) AS (
  VALUES
    ('perfect_world','D','D',0,NULL::integer,NULL::integer),
    ('perfect_world','C','C',1,NULL::integer,NULL::integer),
    ('perfect_world','C+','C+',2,NULL::integer,NULL::integer),
    ('perfect_world','C++','C++',3,NULL::integer,NULL::integer),
    ('perfect_world','B','B',4,NULL::integer,NULL::integer),
    ('perfect_world','B+','B+',5,NULL::integer,NULL::integer),
    ('perfect_world','B++','B++',6,NULL::integer,NULL::integer),
    ('perfect_world','A','A',7,NULL::integer,NULL::integer),
    ('perfect_world','A+','A+',8,NULL::integer,NULL::integer),
    ('perfect_world','A++','A++',9,NULL::integer,NULL::integer),
    ('perfect_world','青铜S','青铜S',10,0,9),
    ('perfect_world','黄金S','黄金S',11,10,24),
    ('perfect_world','钻石S','钻石S',12,25,49),
    ('perfect_world','魔王S','魔王S',13,50,NULL::integer),
    ('fivee','D','D',0,NULL::integer,NULL::integer),
    ('fivee','C','C',1,NULL::integer,NULL::integer),
    ('fivee','C+','C+',2,NULL::integer,NULL::integer),
    ('fivee','C++','C++',3,NULL::integer,NULL::integer),
    ('fivee','B','B',4,NULL::integer,NULL::integer),
    ('fivee','B+','B+',5,NULL::integer,NULL::integer),
    ('fivee','B++','B++',6,NULL::integer,NULL::integer),
    ('fivee','A','A',7,NULL::integer,NULL::integer),
    ('fivee','A+','A+',8,NULL::integer,NULL::integer),
    ('fivee','A++','A++',9,NULL::integer,NULL::integer),
    ('fivee','S','S',10,0,19),
    ('fivee','SS','SS',11,20,39),
    ('fivee','SSS','SSS',12,40,NULL::integer)
)
INSERT INTO "competitive_platform_ranks" ("platform_key", "rank_key", "label", "sort_order", "star_min", "star_max")
SELECT platform_key, rank_key, label, sort_order, star_min, star_max FROM expected
ON CONFLICT ("platform_key", "rank_key") DO UPDATE
SET "star_min" = EXCLUDED."star_min", "star_max" = EXCLUDED."star_max";--> statement-breakpoint
INSERT INTO "competitive_platform_seasons" ("platform", "season_key", "label", "active", "sort_order", "is_current") VALUES
  ('perfect_world', '2026s1', '2026S1', true, 202601, false),
  ('perfect_world', '2026s2', '2026S2', true, 202602, true),
  ('fivee', '2026s3', '2026S3', true, 202603, false),
  ('fivee', '2026s4', '2026S4', true, 202604, true)
ON CONFLICT ("platform", "season_key") DO NOTHING;--> statement-breakpoint
-- Legacy rank facts intentionally receive no fabricated stars. Published event
-- snapshots contain rank order only and are intentionally untouched.
