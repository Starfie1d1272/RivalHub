-- Integration proposal for the #911 migration owner; not an executable migration chain.
-- Append after 0085_free-predictions with generated snapshot/journal; do not run directly.
ALTER TABLE "bet_ledger" DROP CONSTRAINT "bet_ledger_kind";--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed existing rows satisfy the widened kind and relief-only check; transactional replacement preserves old producers and append-only history, with protected rehearsal before production.
ALTER TABLE "bet_ledger" ADD CONSTRAINT "bet_relief_grant" CHECK ("bet_ledger"."kind" <> 'relief' OR ("bet_ledger"."amount" BETWEEN 1 AND 10 AND "bet_ledger"."profit" = 0 AND "bet_ledger"."source" ~ '^relief/[0-9]{4}-[0-9]{2}-[0-9]{2}$'));--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed existing rows satisfy the widened kind and relief-only check; transactional replacement preserves old producers and append-only history, with protected rehearsal before production.
ALTER TABLE "bet_ledger" ADD CONSTRAINT "bet_ledger_kind" CHECK ("bet_ledger"."kind" IN ('initial','stage','relief','stake','settlement','reversal'));
