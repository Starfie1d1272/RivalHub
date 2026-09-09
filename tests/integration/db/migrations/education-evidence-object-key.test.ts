import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLocalPool, capturePostgresError } from "../harness/database";

describe("education evidence object-key migration contract", () => {
  it("replays the active shape constraints and keeps the retention shape valid", async () => {
    const pool = createLocalPool({ max: 2 });
    const userId = randomUUID();
    const verificationIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `education-object-key-${userId}@local.test`]);

      const constraints = await pool.query<{ name: string }>(
        `SELECT conname AS name FROM pg_constraint
         WHERE conrelid = 'public.education_verifications'::regclass
           AND conname IN (
             'education_verifications_evidence_object_type_shape_check',
             'education_verifications_manual_evidence_code_shape_check',
             'education_verifications_manual_pending_object_shape_check'
           )
         ORDER BY conname`,
      );
      expect(constraints.rows.map((row) => row.name)).toEqual([
        "education_verifications_evidence_object_type_shape_check",
        "education_verifications_manual_evidence_code_shape_check",
        "education_verifications_manual_pending_object_shape_check",
      ]);

      const institutionId = institution.rows[0].id;
      await pool.query(
        `INSERT INTO education_verifications
           (id, user_id, institution_id, academic_status, evidence_type, evidence_code, evidence_object_key, status)
         VALUES ($1, $5, $6, 'enrolled', 'manual_other', NULL, $7, 'pending'),
                ($2, $5, $6, 'enrolled', 'manual_other', NULL, NULL, 'approved'),
                ($3, $5, $6, 'enrolled', 'manual_other', NULL, $8, 'rejected'),
                ($4, $5, $6, 'enrolled', 'chsi_enrollment_report', $9, NULL, 'approved')`,
        [...verificationIds, userId, institutionId, `${verificationIds[0]}/object.png`, `${verificationIds[2]}/object.webp`, "ABCD1234EFGH5678"],
      );

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const wrongObjectType = await capturePostgresError(client, () => client.query(
          "UPDATE education_verifications SET evidence_object_key = 'wrong/type.png' WHERE id = $1",
          [verificationIds[3]],
        ));
        expect(wrongObjectType).toMatchObject({ code: "23514", constraint: "education_verifications_evidence_object_type_shape_check" });

        const wrongManualCode = await capturePostgresError(client, () => client.query(
          "UPDATE education_verifications SET evidence_code = 'ABCD1234EFGH5678' WHERE id = $1",
          [verificationIds[0]],
        ));
        expect(wrongManualCode).toMatchObject({ code: "23514", constraint: "education_verifications_manual_evidence_code_shape_check" });

        const missingPendingObject = await capturePostgresError(client, () => client.query(
          "INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, status) VALUES ($1, $2, 'enrolled', 'manual_other', 'pending')",
          [userId, institutionId],
        ));
        expect(missingPendingObject).toMatchObject({ code: "23514", constraint: "education_verifications_manual_pending_object_shape_check" });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }

      const validRows = await pool.query<{ evidence_object_key: string | null; evidence_code: string | null; status: string }>(
        `SELECT evidence_object_key, evidence_code, status::text AS status
         FROM education_verifications WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [verificationIds],
      );
      expect(validRows.rows).toHaveLength(4);
      expect(validRows.rows.some((row) => row.status === "pending" && row.evidence_object_key?.endsWith(".png"))).toBe(true);
      expect(validRows.rows.some((row) => row.status === "approved" && row.evidence_object_key === null && row.evidence_code === "ABCD1234EFGH5678")).toBe(true);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [verificationIds]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });
});
