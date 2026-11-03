CREATE TABLE "statistics_invalidation" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"published_generation" bigint DEFAULT 0 NOT NULL,
	"last_transaction_id" bigint NOT NULL,
	CONSTRAINT "statistics_invalidation_singleton_check" CHECK ("statistics_invalidation"."id" = 'global'),
	CONSTRAINT "statistics_invalidation_generation_check" CHECK ("statistics_invalidation"."generation" > 0 AND "statistics_invalidation"."published_generation" >= 0 AND "statistics_invalidation"."published_generation" <= "statistics_invalidation"."generation")
);
--> statement-breakpoint
ALTER TABLE "statistics_invalidation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.statistics_invalidation FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- WIP: these two inputs do not cover every public statistics dependency.
CREATE FUNCTION public.enqueue_statistics_invalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
DECLARE current_tx bigint := txid_current();
BEGIN
  INSERT INTO statistics_invalidation(id, generation, published_generation, last_transaction_id)
  VALUES ('global', 1, 0, current_tx)
  ON CONFLICT (id) DO UPDATE SET
    generation = statistics_invalidation.generation + 1,
    last_transaction_id = current_tx
  WHERE statistics_invalidation.last_transaction_id <> current_tx;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enqueue_statistics_invalidation() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_insert_delete AFTER INSERT OR DELETE ON public.match_demo_imports FOR EACH ROW EXECUTE FUNCTION public.enqueue_statistics_invalidation();
--> statement-breakpoint
-- Latest-import selection, source validity and attribution can change public output.
-- Exclude operational metadata such as issues, submitted_by and confirmed_at.
CREATE TRIGGER statistics_invalidation_update AFTER UPDATE ON public.match_demo_imports FOR EACH ROW
WHEN (ROW(OLD.id, OLD.match_id, OLD.match_map_id, OLD.semantic_profile, OLD.status, OLD.evidence_revision,
          OLD.payload_sha256, OLD.demo_sha256, OLD.analysis_version, OLD.created_at, OLD.payload)
  IS DISTINCT FROM ROW(NEW.id, NEW.match_id, NEW.match_map_id, NEW.semantic_profile, NEW.status, NEW.evidence_revision,
          NEW.payload_sha256, NEW.demo_sha256, NEW.analysis_version, NEW.created_at, NEW.payload))
EXECUTE FUNCTION public.enqueue_statistics_invalidation();
--> statement-breakpoint
CREATE TRIGGER statistics_invalidation_insert_delete AFTER INSERT OR DELETE ON public.match_demo_stat_projections FOR EACH ROW EXECUTE FUNCTION public.enqueue_statistics_invalidation();
--> statement-breakpoint
-- created_at alone changes during an otherwise identical projection upsert.
CREATE TRIGGER statistics_invalidation_update AFTER UPDATE ON public.match_demo_stat_projections FOR EACH ROW
WHEN (ROW(OLD.import_id, OLD.projection_version, OLD.payload_sha256, OLD.demo_sha256, OLD.semantic_profile,
          OLD.analysis_version, OLD.evidence_revision, OLD.identity_bindings, OLD.facts)
  IS DISTINCT FROM ROW(NEW.import_id, NEW.projection_version, NEW.payload_sha256, NEW.demo_sha256, NEW.semantic_profile,
          NEW.analysis_version, NEW.evidence_revision, NEW.identity_bindings, NEW.facts))
EXECUTE FUNCTION public.enqueue_statistics_invalidation();
