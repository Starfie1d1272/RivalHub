-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the stage-scoped bracket owner and Major Swiss StageRun projection; no shipped consumer remains.
DROP TABLE "competition_bracket_states" CASCADE;--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup v2.8.2 production has the Major Swiss StageRun projection; no shipped consumer remains.
DROP TABLE "swiss_standings" CASCADE;
