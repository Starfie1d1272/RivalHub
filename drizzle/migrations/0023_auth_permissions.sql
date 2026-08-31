-- Validate every legacy value before changing or dropping its source.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE ("role" = 'user' AND cardinality(COALESCE("admin_season_id", '{}'::uuid[])) > 0)
       OR ("role" = 'season_admin' AND cardinality(COALESCE("admin_season_id", '{}'::uuid[])) = 0)
       OR ("role" = 'super_admin' AND cardinality(COALESCE("admin_season_id", '{}'::uuid[])) > 0)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'auth-permissions migration refused inconsistent users.role/admin_season_id data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users" AS u
    CROSS JOIN LATERAL unnest(COALESCE(u."admin_season_id", '{}'::uuid[])) AS legacy(season_id)
    LEFT JOIN "seasons" AS s ON s."id" = legacy.season_id
    WHERE legacy.season_id IS NULL OR s."id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'foreign_key_violation',
      MESSAGE = 'auth-permissions migration refused missing or invalid season grant reference';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "admin_invites"
    WHERE "max_uses" <= 0
       OR "used_count" < 0
       OR "used_count" > "max_uses"
       OR "used_count" <> cardinality(COALESCE("used_by_usernames", '{}'::text[]))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'auth-permissions migration refused inconsistent admin invite usage data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "admin_invites"
    WHERE ("role" = 'admin' AND "season_id" IS NULL)
       OR ("role" = 'super_admin' AND "season_id" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'auth-permissions migration refused inconsistent admin invite scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "admin_invites" AS i
    CROSS JOIN LATERAL unnest(COALESCE(i."used_by_usernames", '{}'::text[])) AS legacy(username)
    LEFT JOIN "users" AS u
      ON lower(btrim(u."email")) = lower(btrim(legacy.username))
    WHERE legacy.username IS NULL
       OR btrim(legacy.username) = ''
       OR u."id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'foreign_key_violation',
      MESSAGE = 'auth-permissions migration refused unresolvable admin invite claimant';
  END IF;

  IF EXISTS (
    WITH legacy AS (
      SELECT i."id" AS invite_id, lower(btrim(legacy.username)) AS normalized_username
      FROM "admin_invites" AS i
      CROSS JOIN LATERAL unnest(COALESCE(i."used_by_usernames", '{}'::text[])) AS legacy(username)
    )
    SELECT 1
    FROM legacy
    JOIN "users" AS u ON lower(btrim(u."email")) = legacy.normalized_username
    GROUP BY legacy.invite_id, legacy.normalized_username
    HAVING count(u."id") <> 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'auth-permissions migration refused ambiguous admin invite claimant';
  END IF;

  IF EXISTS (
    WITH legacy AS (
      SELECT i."id" AS invite_id, lower(btrim(legacy.username)) AS normalized_username
      FROM "admin_invites" AS i
      CROSS JOIN LATERAL unnest(COALESCE(i."used_by_usernames", '{}'::text[])) AS legacy(username)
    )
    SELECT 1
    FROM legacy
    GROUP BY legacy.invite_id, legacy.normalized_username
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'auth-permissions migration refused duplicate admin invite claimant';
  END IF;
END $$;
--> statement-breakpoint
CREATE TYPE "public"."admin_invite_role" AS ENUM('season_admin', 'super_admin');
--> statement-breakpoint
CREATE TABLE "admin_invite_claims" (
	"invite_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_invite_claims_invite_user_unique" UNIQUE("invite_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "season_admin_grants" (
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_user_id" uuid,
	CONSTRAINT "season_admin_grants_user_season_unique" UNIQUE("user_id","season_id")
);
--> statement-breakpoint
INSERT INTO "season_admin_grants" ("user_id", "season_id", "granted_at", "granted_by_user_id")
SELECT DISTINCT u."id", legacy.season_id, u."updated_at", NULL::uuid
FROM "users" AS u
CROSS JOIN LATERAL unnest(COALESCE(u."admin_season_id", '{}'::uuid[])) AS legacy(season_id)
WHERE u."role" = 'season_admin'
ON CONFLICT ("user_id", "season_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "admin_invite_claims" ("invite_id", "user_id", "claimed_at")
SELECT i."id", u."id", i."created_at"
FROM "admin_invites" AS i
CROSS JOIN LATERAL unnest(COALESCE(i."used_by_usernames", '{}'::text[])) AS legacy(username)
JOIN "users" AS u ON lower(btrim(u."email")) = lower(btrim(legacy.username));
--> statement-breakpoint
UPDATE "admin_invites" AS i
SET "is_active" = false
WHERE (
  SELECT count(*)
  FROM "admin_invite_claims" AS c
  WHERE c."invite_id" = i."id"
) >= i."max_uses";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;
--> statement-breakpoint
UPDATE "users" SET "role" = 'user' WHERE "role" = 'season_admin';
--> statement-breakpoint
DROP TYPE "public"."user_role";
--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'super_admin');
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::"public"."user_role";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";
--> statement-breakpoint
ALTER TABLE "admin_invites" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "admin_invites" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;
--> statement-breakpoint
UPDATE "admin_invites" SET "role" = 'season_admin' WHERE "role" = 'admin';
--> statement-breakpoint
ALTER TABLE "admin_invites" ALTER COLUMN "role" SET DEFAULT 'season_admin'::"public"."admin_invite_role";
--> statement-breakpoint
ALTER TABLE "admin_invites" ALTER COLUMN "role" SET DATA TYPE "public"."admin_invite_role" USING "role"::"public"."admin_invite_role";
--> statement-breakpoint
ALTER TABLE "admin_invite_claims" ADD CONSTRAINT "admin_invite_claims_invite_id_admin_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."admin_invites"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_invite_claims" ADD CONSTRAINT "admin_invite_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "season_admin_grants" ADD CONSTRAINT "season_admin_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "season_admin_grants" ADD CONSTRAINT "season_admin_grants_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "season_admin_grants" ADD CONSTRAINT "season_admin_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "admin_invite_claims_invite_id_idx" ON "admin_invite_claims" USING btree ("invite_id");
--> statement-breakpoint
CREATE INDEX "admin_invite_claims_user_id_idx" ON "admin_invite_claims" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "season_admin_grants_user_id_idx" ON "season_admin_grants" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "season_admin_grants_season_id_idx" ON "season_admin_grants" USING btree ("season_id");
--> statement-breakpoint
ALTER TABLE "admin_invite_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "season_admin_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "admin_invite_claims", "season_admin_grants" FROM anon, authenticated;
--> statement-breakpoint
ALTER TABLE "admin_invites" DROP COLUMN "used_count";
--> statement-breakpoint
ALTER TABLE "admin_invites" DROP COLUMN "used_by_usernames";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "admin_season_id";
--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_max_uses_positive" CHECK ("admin_invites"."max_uses" > 0);
--> statement-breakpoint
ALTER TABLE "admin_invites" ADD CONSTRAINT "admin_invites_role_season_scope" CHECK (("admin_invites"."role" = 'season_admin' AND "admin_invites"."season_id" IS NOT NULL) OR ("admin_invites"."role" = 'super_admin' AND "admin_invites"."season_id" IS NULL));
--> statement-breakpoint
DROP TABLE "admin_users";
--> statement-breakpoint
DROP TYPE "public"."admin_role";
