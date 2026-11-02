CREATE TABLE "free_prediction_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" jsonb NOT NULL,
	"selection" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "free_prediction_choices_user_id_match_id_kind_unique" UNIQUE("user_id","match_id","kind"),
	CONSTRAINT "free_prediction_kind" CHECK ("free_prediction_choices"."kind" in ('result','bp'))
);
--> statement-breakpoint
CREATE TABLE "free_prediction_locks" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"result_locked_at" timestamp with time zone,
	"bp_locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "free_prediction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"choice_id" uuid NOT NULL,
	"selection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "free_prediction_requests_user_id_request_id_unique" UNIQUE("user_id","request_id")
);
--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Constraint applies only to newly created empty prediction tables.
ALTER TABLE "free_prediction_choices" ADD CONSTRAINT "free_prediction_choices_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Constraint applies only to newly created empty prediction tables.
ALTER TABLE "free_prediction_choices" ADD CONSTRAINT "free_prediction_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Constraint applies only to newly created empty prediction tables.
ALTER TABLE "free_prediction_locks" ADD CONSTRAINT "free_prediction_locks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Constraint applies only to newly created empty prediction tables.
ALTER TABLE "free_prediction_requests" ADD CONSTRAINT "free_prediction_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed Constraint applies only to newly created empty prediction tables.
ALTER TABLE "free_prediction_requests" ADD CONSTRAINT "free_prediction_requests_choice_id_free_prediction_choices_id_fk" FOREIGN KEY ("choice_id") REFERENCES "public"."free_prediction_choices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.free_prediction_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_prediction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.free_prediction_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_prediction_choices, public.free_prediction_requests, public.free_prediction_locks FROM anon, authenticated;
--> statement-breakpoint
-- These monotone fences consume canonical starts. They do not alter match/BP facts.
CREATE FUNCTION public.capture_free_prediction_start() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE m public.matches%ROWTYPE; result_at timestamptz; bp_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'matches' THEN
    m := NEW;
    result_at := NEW.gameplay_started_at;
    IF NEW.status IN ('finished','cancelled') OR NEW.is_forfeit THEN result_at := COALESCE(result_at, clock_timestamp()); END IF;
  ELSE
    -- Parent lock serializes even direct canonical fact writes with prediction submission.
    SELECT * INTO m FROM public.matches WHERE id = NEW.match_id FOR UPDATE;
    IF TG_TABLE_NAME = 'match_veto_sessions' THEN
      bp_at := COALESCE(NEW.started_at, NEW.completed_at);
    ELSE
      result_at := COALESCE(NEW.started_at, NEW.completed_at);
    END IF;
  END IF;
  IF m.season_id IS NULL OR m.test_config IS NOT NULL THEN RETURN NEW; END IF;
  IF result_at IS NOT NULL OR bp_at IS NOT NULL THEN
    INSERT INTO public.free_prediction_locks(match_id, season_id, result_locked_at, bp_locked_at)
      VALUES(m.id,m.season_id,result_at,COALESCE(bp_at,result_at))
      ON CONFLICT (match_id) DO UPDATE SET
        result_locked_at = COALESCE(free_prediction_locks.result_locked_at, EXCLUDED.result_locked_at),
        bp_locked_at = COALESCE(free_prediction_locks.bp_locked_at, EXCLUDED.bp_locked_at);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER free_prediction_match_start AFTER INSERT OR UPDATE OF gameplay_started_at, status, is_forfeit ON public.matches FOR EACH ROW EXECUTE FUNCTION public.capture_free_prediction_start();
CREATE TRIGGER free_prediction_map_start AFTER INSERT OR UPDATE OF started_at, completed_at ON public.match_maps FOR EACH ROW EXECUTE FUNCTION public.capture_free_prediction_start();
CREATE TRIGGER free_prediction_bp_start AFTER INSERT OR UPDATE OF started_at, completed_at ON public.match_veto_sessions FOR EACH ROW EXECUTE FUNCTION public.capture_free_prediction_start();
--> statement-breakpoint
INSERT INTO public.free_prediction_locks(match_id,season_id,result_locked_at,bp_locked_at)
SELECT m.id,m.season_id,
  COALESCE(m.gameplay_started_at, maps.started_at, CASE WHEN m.status IN ('finished','cancelled') OR m.is_forfeit THEN COALESCE(m.completed_at,m.updated_at) END),
  COALESCE(v.started_at,v.completed_at,m.gameplay_started_at,maps.started_at,CASE WHEN m.status IN ('finished','cancelled') OR m.is_forfeit THEN COALESCE(m.completed_at,m.updated_at) END)
FROM public.matches m LEFT JOIN public.match_veto_sessions v ON v.match_id=m.id
LEFT JOIN LATERAL (SELECT min(COALESCE(started_at,completed_at)) started_at FROM public.match_maps WHERE match_id=m.id) maps ON true
WHERE m.season_id IS NOT NULL AND m.test_config IS NULL;
