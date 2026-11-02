CREATE TABLE "match_actual_start_adoptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"original_fact_at" timestamp with time zone,
	"previous_at" timestamp with time zone,
	"actual_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	CONSTRAINT "match_actual_start_adoptions_match_id_revision_unique" UNIQUE("match_id","revision"),
	CONSTRAINT "match_actual_start_adoptions_match_id_request_id_unique" UNIQUE("match_id","request_id"),
	CONSTRAINT "match_actual_start_revision_positive" CHECK ("match_actual_start_adoptions"."revision" > 0),
	CONSTRAINT "match_actual_start_explanation" CHECK (length(trim("match_actual_start_adoptions"."reason")) between 1 and 500 and length(trim("match_actual_start_adoptions"."evidence")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "match_actual_start_adoptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Index is created on the new empty adoption table.
CREATE INDEX "match_actual_start_season_match_idx" ON "match_actual_start_adoptions" USING btree ("season_id","match_id");--> statement-breakpoint
REVOKE ALL ON TABLE public.match_actual_start_adoptions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER match_actual_start_append_only BEFORE UPDATE OR DELETE ON public.match_actual_start_adoptions FOR EACH ROW EXECUTE FUNCTION public.rivalhub_prediction_append_only();
