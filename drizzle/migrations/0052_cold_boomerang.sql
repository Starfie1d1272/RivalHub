-- rivalhub:migration-risk: contract-cleanup the unused major prestart issue ledger has no production rows and all application references are removed in this change
DROP TABLE "major_prestart_issues";--> statement-breakpoint
-- rivalhub:migration-risk: contract-cleanup the category enum has no remaining application owner after the issue ledger removal
DROP TYPE "public"."major_prestart_issue_category";
