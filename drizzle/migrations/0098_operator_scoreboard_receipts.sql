CREATE TABLE "operator_scoreboard_receipts" (
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"payload_digest" text NOT NULL,
	"base_version" text NOT NULL,
	"result_version" text NOT NULL,
	"result_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_scoreboard_receipts_actor_user_id_operation_id_pk" PRIMARY KEY("actor_user_id","operation_id"),
	CONSTRAINT "operator_scoreboard_receipts_operation_check" CHECK ("operator_scoreboard_receipts"."operation" IN ('save','clear')),
	CONSTRAINT "operator_scoreboard_receipts_digest_check" CHECK ("operator_scoreboard_receipts"."payload_digest" ~ '^[0-9a-f]{64}$' AND "operator_scoreboard_receipts"."base_version" ~ '^[0-9a-f]{64}$' AND "operator_scoreboard_receipts"."result_version" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operator_scoreboard_receipts_count_check" CHECK ("operator_scoreboard_receipts"."result_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "operator_scoreboard_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty receipt table references existing parent keys.
ALTER TABLE "operator_scoreboard_receipts" ADD CONSTRAINT "operator_scoreboard_receipts_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed New empty receipt table references existing parent keys.
ALTER TABLE "operator_scoreboard_receipts" ADD CONSTRAINT "operator_scoreboard_receipts_map_id_match_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."match_maps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Index created only on a new empty receipt table.
CREATE INDEX "operator_scoreboard_receipts_map_idx" ON "operator_scoreboard_receipts" USING btree ("map_id");
--> statement-breakpoint
REVOKE ALL ON public.operator_scoreboard_receipts FROM PUBLIC, anon, authenticated;
