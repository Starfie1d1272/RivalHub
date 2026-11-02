-- rivalhub:migration-risk: locking-reviewed Narrow match variants without rewriting historical competition rows; constraints validate in the bounded migration transaction.
ALTER TABLE "matches" DROP CONSTRAINT "matches_execution_context_shape";
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Narrow match variants without rewriting historical competition rows; constraints validate in the bounded migration transaction.
ALTER TABLE "matches" ADD CONSTRAINT "matches_independent_result_shape" CHECK ("matches"."season_id" IS NOT NULL OR (("matches"."status" != 'finished' AND "matches"."result_disposition" IS NULL AND "matches"."score_a" IS NULL AND "matches"."score_b" IS NULL) OR ("matches"."status" = 'finished' AND "matches"."result_disposition" IS NOT NULL)));
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Narrow match variants without rewriting historical competition rows; constraints validate in the bounded migration transaction.
ALTER TABLE "matches" ADD CONSTRAINT "matches_execution_context_shape" CHECK (("matches"."season_id" IS NOT NULL AND "matches"."entry_a_id" IS NOT NULL AND "matches"."entry_b_id" IS NOT NULL AND "matches"."stage" IS NOT NULL AND "matches"."execution_context" IS NULL) OR ("matches"."season_id" IS NULL AND "matches"."entry_a_id" IS NULL AND "matches"."entry_b_id" IS NULL AND "matches"."stage" IS NULL AND "matches"."execution_context" IS NOT NULL AND "matches"."major_stage_run_id" IS NULL AND "matches"."qualification_run_id" IS NULL AND "matches"."bracket_node_id" IS NULL));
