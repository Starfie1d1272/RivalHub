-- rivalhub:migration-risk: contract-cleanup Additive enum value is required for default lineup provenance; no existing value is changed.
ALTER TYPE "public"."match_roster_source" ADD VALUE 'system_default' BEFORE 'admin_select';--> statement-breakpoint
