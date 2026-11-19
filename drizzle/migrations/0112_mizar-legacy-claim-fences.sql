CREATE TABLE "mizar_legacy_claim_fences" (
	"installation_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"producer_instance_id" text NOT NULL,
	"live_session_id" text NOT NULL,
	CONSTRAINT "mizar_legacy_claim_fences_scope_pk" PRIMARY KEY("installation_id","match_id","producer_instance_id","live_session_id")
);
--> statement-breakpoint
ALTER TABLE "mizar_legacy_claim_fences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON "mizar_legacy_claim_fences" FROM anon, authenticated;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty table; foreign key validation takes a brief parent lock.
ALTER TABLE "mizar_legacy_claim_fences" ADD CONSTRAINT "mizar_legacy_claim_fences_installation_id_mizar_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."mizar_installations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty table; foreign key validation takes a brief parent lock.
ALTER TABLE "mizar_legacy_claim_fences" ADD CONSTRAINT "mizar_legacy_claim_fences_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;