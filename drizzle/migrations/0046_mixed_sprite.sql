ALTER TABLE "education_verifications" ADD COLUMN "evidence_object_key" text;--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed additive education shape check validated against existing nullable rows
ALTER TABLE "education_verifications" ADD CONSTRAINT "education_verifications_evidence_object_type_shape_check" CHECK ("education_verifications"."evidence_object_key" IS NULL OR "education_verifications"."evidence_type" = 'manual_other');--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed additive education shape check validated against existing nullable rows
ALTER TABLE "education_verifications" ADD CONSTRAINT "education_verifications_manual_evidence_code_shape_check" CHECK ("education_verifications"."evidence_type" <> 'manual_other' OR "education_verifications"."evidence_code" IS NULL);--> statement-breakpoint
-- rivalhub:migration-risk: locking-reviewed additive education shape check validated against existing nullable rows
ALTER TABLE "education_verifications" ADD CONSTRAINT "education_verifications_manual_pending_object_shape_check" CHECK (NOT ("education_verifications"."evidence_type" = 'manual_other' AND "education_verifications"."status" = 'pending') OR "education_verifications"."evidence_object_key" IS NOT NULL);
--> statement-breakpoint

-- Supabase Storage is optional during plain PostgreSQL migration replay. When
-- present, this migration is the sole owner of the sensitive bucket contract.
DO $$
DECLARE
  bucket_exists boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = $1 OR name = $1)'
    INTO bucket_exists
    USING 'education-evidence';

  IF bucket_exists THEN
    EXECUTE 'UPDATE storage.buckets
      SET name = $1, public = false, file_size_limit = $2, allowed_mime_types = $3
      WHERE id = $1 OR name = $1'
      USING 'education-evidence', 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];
  ELSE
    EXECUTE 'INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ($1, $1, false, $2, $3)'
      USING 'education-evidence', 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];
  END IF;
END $$;
