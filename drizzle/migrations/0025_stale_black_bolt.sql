-- Preserve only the external fact CHSI uses to verify a report. URL parameters
-- such as trnd/srcid are transient share-link state, not evidence identity.
ALTER TABLE "education_verifications" ADD COLUMN "evidence_code" text;--> statement-breakpoint

UPDATE "education_verifications"
SET "evidence_code" = upper((regexp_match("evidence_url", '(?i)[?&]vcode=([a-z0-9]{12}|[a-z0-9]{16})(?:[&#]|$)'))[1])
WHERE "evidence_type" IN ('chsi_enrollment_report', 'chsi_education_report');--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "education_verifications"
    WHERE "evidence_type" IN ('chsi_enrollment_report', 'chsi_education_report')
      AND (
        "evidence_url" !~* '^https://(www\.)?chsi\.com\.cn(?:/|[?#]|$)'
        OR (SELECT count(*) FROM regexp_matches("evidence_url", '(?i)[?&]vcode=', 'g')) <> 1
        OR "evidence_code" !~ '^(?:[A-Z0-9]{16}|[0-9]{12})$'
      )
  ) THEN
    RAISE EXCEPTION 'education verification migration cannot safely extract a CHSI online verification code' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "education_verifications"
    WHERE "evidence_type" NOT IN ('chsi_enrollment_report', 'chsi_education_report')
      AND "evidence_url" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'education verification migration cannot discard non-CHSI URL evidence' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "education_verifications"
  ADD CONSTRAINT "education_verifications_evidence_code_contract"
  CHECK (
    ("evidence_type" IN ('chsi_enrollment_report', 'chsi_education_report')
      AND "evidence_code" ~ '^(?:[A-Z0-9]{16}|[0-9]{12})$')
    OR ("evidence_type" NOT IN ('chsi_enrollment_report', 'chsi_education_report')
      AND "evidence_code" IS NULL)
  );--> statement-breakpoint

ALTER TABLE "education_verifications" DROP COLUMN "evidence_url";
