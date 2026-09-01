DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "user_competitive_roles"
    WHERE "role"::text NOT IN ('igl', 'awper', 'opener', 'closer', 'anchor')
  ) THEN
    RAISE EXCEPTION 'participant-profile migration found non-canonical cs2 role';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "user_competitive_roles" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."cs2_role";--> statement-breakpoint
CREATE TYPE "public"."cs2_role" AS ENUM('igl', 'awper', 'opener', 'closer', 'anchor');--> statement-breakpoint
ALTER TABLE "user_competitive_roles" ALTER COLUMN "role" SET DATA TYPE "public"."cs2_role" USING "role"::"public"."cs2_role";--> statement-breakpoint
DROP INDEX "users_perfect_id_normalized_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "perfect_id";
