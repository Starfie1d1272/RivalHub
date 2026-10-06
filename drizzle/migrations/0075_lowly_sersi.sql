CREATE TABLE "bet_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bet_accounts_season_id_user_id_unique" UNIQUE("season_id","user_id"),
	CONSTRAINT "bet_accounts_id_season_id_unique" UNIQUE("id","season_id")
);
--> statement-breakpoint
CREATE TABLE "bet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"profit" bigint DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bet_ledger_account_id_source_unique" UNIQUE("account_id","source"),
	CONSTRAINT "bet_ledger_kind" CHECK ("bet_ledger"."kind" IN ('initial','stage','stake','settlement','reversal'))
);
--> statement-breakpoint
CREATE TABLE "bet_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"match_id" uuid,
	"market_key" text NOT NULL,
	"type" text NOT NULL,
	"subject" jsonb NOT NULL,
	"line_twice" integer,
	"locked_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bet_markets_season_id_market_key_unique" UNIQUE("season_id","market_key"),
	CONSTRAINT "bet_markets_id_season_id_unique" UNIQUE("id","season_id"),
	CONSTRAINT "bet_line_half" CHECK ("bet_markets"."line_twice" IS NULL OR ("bet_markets"."line_twice" > 0 AND "bet_markets"."line_twice" % 2 = 1))
);
--> statement-breakpoint
CREATE TABLE "bet_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "bet_options_market_id_key_unique" UNIQUE("market_id","key"),
	CONSTRAINT "bet_options_id_market_id_unique" UNIQUE("id","market_id"),
	CONSTRAINT "bet_options_market_id_position_unique" UNIQUE("market_id","position")
);
--> statement-breakpoint
CREATE TABLE "bet_programs" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"dirty" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bet_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"winning_option_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bet_settlements_market_id_revision_unique" UNIQUE("market_id","revision"),
	CONSTRAINT "bet_settlement_state" CHECK ("bet_settlements"."state" IN ('pending','settled','refunded'))
);
--> statement-breakpoint
CREATE TABLE "bet_stage_milestones" (
	"season_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bet_stage_milestones_season_id_stage_key_unique" UNIQUE("season_id","stage_key")
);
--> statement-breakpoint
CREATE TABLE "bet_stakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"request_id" uuid NOT NULL,
	"all_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bet_stakes_account_id_request_id_unique" UNIQUE("account_id","request_id"),
	CONSTRAINT "bet_stake_positive" CHECK ("bet_stakes"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "match_maps" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_accounts" ADD CONSTRAINT "bet_accounts_season_id_bet_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bet_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_accounts" ADD CONSTRAINT "bet_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_ledger" ADD CONSTRAINT "bet_ledger_account_id_season_id_bet_accounts_id_season_id_fk" FOREIGN KEY ("account_id","season_id") REFERENCES "public"."bet_accounts"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_markets" ADD CONSTRAINT "bet_markets_season_id_bet_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bet_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_options" ADD CONSTRAINT "bet_options_market_id_bet_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."bet_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_programs" ADD CONSTRAINT "bet_programs_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_settlements" ADD CONSTRAINT "bet_settlements_market_id_bet_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."bet_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_stage_milestones" ADD CONSTRAINT "bet_stage_milestones_season_id_bet_programs_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."bet_programs"("season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_stakes" ADD CONSTRAINT "bet_stakes_market_id_season_id_bet_markets_id_season_id_fk" FOREIGN KEY ("market_id","season_id") REFERENCES "public"."bet_markets"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_stakes" ADD CONSTRAINT "bet_stakes_account_id_season_id_bet_accounts_id_season_id_fk" FOREIGN KEY ("account_id","season_id") REFERENCES "public"."bet_accounts"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
ALTER TABLE "bet_stakes" ADD CONSTRAINT "bet_stakes_option_id_market_id_bet_options_id_market_id_fk" FOREIGN KEY ("option_id","market_id") REFERENCES "public"."bet_options"("id","market_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
CREATE INDEX "bet_ledger_account_idx" ON "bet_ledger" USING btree ("season_id","account_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
CREATE INDEX "bet_markets_match_idx" ON "bet_markets" USING btree ("match_id");--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed new empty BET tables; no existing rows scanned
CREATE INDEX "bet_stakes_market_idx" ON "bet_stakes" USING btree ("market_id","option_id");--> statement-breakpoint
