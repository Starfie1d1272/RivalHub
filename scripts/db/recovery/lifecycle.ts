import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { buildIsolatedRecoveryEnvironment } from "./environment";
import { purgeExpiredEducationEvidence } from "../../../src/lib/education/retention-core";

async function main(): Promise<void> {
  const target = buildIsolatedRecoveryEnvironment(process.env);
  const client = createClient(target.supabase.apiUrl, target.supabase.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pool = new Pool({ connectionString: target.databaseUrl, ssl: false, max: 1 });
  try {
    const cleared = await purgeExpiredEducationEvidence({
      findExpiredManualEvidence: async (reviewedBefore) => {
        const result = await pool.query<{ id: string; evidence_object_key: string | null }>(
          `SELECT id::text, evidence_object_key
           FROM public.education_verifications
           WHERE status <> 'pending'
             AND reviewed_at <= $1
             AND evidence_type = 'manual_other'
             AND evidence_object_key IS NOT NULL`,
          [reviewedBefore],
        );
        return result.rows.flatMap((row) => row.evidence_object_key
          ? [{ id: row.id, evidenceObjectKey: row.evidence_object_key }]
          : []);
      },
      removeEvidenceObject: async (objectKey) => {
        const result = await client.storage.from("education-evidence").remove([objectKey]);
        if (result.error && !isMissingObjectError(result.error)) {
          throw new Error("Education evidence lifecycle Storage cleanup failed; restore reconciliation aborted. ");
        }
      },
      clearManualEvidence: async (id, objectKey) => {
        const result = await pool.query(
          `UPDATE public.education_verifications
           SET evidence_object_key = NULL
           WHERE id = $1::uuid AND evidence_object_key = $2
           RETURNING id`,
          [id, objectKey],
        );
        return result.rowCount ?? 0;
      },
      clearExpiredChsiCodes: async (reviewedBefore) => {
        const result = await pool.query(
          `UPDATE public.education_verifications
           SET evidence_code = NULL
           WHERE status <> 'pending'
             AND reviewed_at <= $1
             AND evidence_type <> 'manual_other'
             AND evidence_code IS NOT NULL
           RETURNING id`,
          [reviewedBefore],
        );
        return result.rowCount ?? 0;
      },
    });
    console.log(`Recovery lifecycle reconciliation complete: cleared=${cleared}.`);
  } finally {
    await pool.end();
  }
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404
    || candidate.statusCode === "404"
    || candidate.code === "NotFound"
    || candidate.code === "NoSuchKey";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recovery lifecycle reconciliation failed.");
  process.exitCode = 1;
});
