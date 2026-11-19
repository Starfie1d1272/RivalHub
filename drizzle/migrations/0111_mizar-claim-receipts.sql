CREATE TABLE "mizar_claim_receipts" (
	"installation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"source_id" uuid,
	CONSTRAINT "mizar_claim_receipts_installation_id_match_id_request_id_pk" PRIMARY KEY("installation_id","match_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "mizar_claim_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "mizar_claim_receipts" FROM anon, authenticated;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty receipts table; foreign key validation has no rows and takes a brief lock on the parent.
ALTER TABLE "mizar_claim_receipts" ADD CONSTRAINT "mizar_claim_receipts_installation_id_mizar_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."mizar_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty receipts table; foreign key validation has no rows and takes a brief lock on the parent.
ALTER TABLE "mizar_claim_receipts" ADD CONSTRAINT "mizar_claim_receipts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty receipts table; foreign key validation has no rows and takes a brief lock on the parent.
ALTER TABLE "mizar_claim_receipts" ADD CONSTRAINT "mizar_claim_receipts_source_id_match_live_sessions_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."match_live_sessions"("id") ON DELETE no action ON UPDATE no action;
