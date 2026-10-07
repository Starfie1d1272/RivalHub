ALTER TABLE "matches" ALTER COLUMN "season_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "entry_a_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "entry_b_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "stage" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "execution_context" jsonb;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "result_disposition" text;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Add context checks without rewriting historical event rows; validate during the existing bounded migration transaction.
ALTER TABLE "matches" ADD CONSTRAINT "matches_execution_context_shape" CHECK (("matches"."season_id" IS NOT NULL AND "matches"."entry_a_id" IS NOT NULL AND "matches"."entry_b_id" IS NOT NULL AND "matches"."stage" IS NOT NULL) OR ("matches"."season_id" IS NULL AND "matches"."entry_a_id" IS NULL AND "matches"."entry_b_id" IS NULL AND "matches"."stage" IS NULL AND "matches"."execution_context" IS NOT NULL AND "matches"."major_stage_run_id" IS NULL AND "matches"."qualification_run_id" IS NULL AND "matches"."bracket_node_id" IS NULL));
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Add context checks without rewriting historical event rows; validate during the existing bounded migration transaction.
ALTER TABLE "matches" ADD CONSTRAINT "matches_result_disposition_shape" CHECK ("matches"."result_disposition" IS NULL OR ("matches"."result_disposition" IN ('pending', 'recorded', 'omitted') AND "matches"."status" = 'finished' AND (("matches"."result_disposition" = 'recorded' AND "matches"."score_a" IS NOT NULL AND "matches"."score_b" IS NOT NULL) OR ("matches"."result_disposition" IN ('pending', 'omitted') AND "matches"."score_a" IS NULL AND "matches"."score_b" IS NULL))));
