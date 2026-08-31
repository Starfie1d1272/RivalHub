import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TERMINAL_MIGRATION = "0025_stale_black_bolt.sql";

async function replayBeforeEvidenceMigration(client: Client): Promise<void> {
  for (const migration of migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name)).filter((name) => name !== TERMINAL_MIGRATION)) {
    await replayMigration(client, migration);
  }
}

async function insertVerification(client: Client, input: { evidenceType: "institutional_email" | "chsi_enrollment_report" | "chsi_education_report"; evidenceUrl: string | null }): Promise<string> {
  const userId = randomUUID();
  const institution = await client.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
  if (!institution.rows[0]) throw new Error("迁移 fixture 缺少高校目录记录。");
  await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `education-code-${userId}@local.test`]);
  const result = await client.query<{ id: string }>(
    `INSERT INTO education_verifications (user_id, institution_id, academic_status, evidence_type, evidence_url, status)
     VALUES ($1, $2, 'enrolled', $3, $4, 'pending') RETURNING id`,
    [userId, institution.rows[0].id, input.evidenceType, input.evidenceUrl],
  );
  return result.rows[0]!.id;
}

describe("education evidence-code migration", () => {
  it("backfills only vcode and fails closed before discarding an unextractable legacy URL", async () => {
    await withScratchDatabase("rivalhub_education_code", async (client) => {
      await replayBeforeEvidenceMigration(client);

      const unsafeId = await insertVerification(client, {
        evidenceType: "chsi_enrollment_report",
        evidenceUrl: "https://www.chsi.com.cn/xlcx/bg.do?trnd=temporary-only",
      });
      await expect(replayMigration(client, TERMINAL_MIGRATION)).rejects.toThrow("cannot safely extract a CHSI online verification code");
      const legacyColumn = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
         WHERE table_name = 'education_verifications' AND column_name = 'evidence_url'`,
      );
      expect(legacyColumn.rows[0]?.count).toBe("1");
      await client.query("DELETE FROM education_verifications WHERE id = $1", [unsafeId]);

      const currentId = await insertVerification(client, {
        evidenceType: "chsi_enrollment_report",
        evidenceUrl: "https://www.chsi.com.cn/xlcx/bg.do?vcode=abcd1234efgh5678&trnd=transient&srcid=archive",
      });
      const legacyId = await insertVerification(client, {
        evidenceType: "chsi_education_report",
        evidenceUrl: "https://chsi.com.cn/xlcx/bg.do?srcid=archive&vcode=102509633215",
      });
      await insertVerification(client, { evidenceType: "institutional_email", evidenceUrl: null });
      await replayMigration(client, TERMINAL_MIGRATION);

      const codes = await client.query<{ id: string; evidence_code: string | null }>(
        "SELECT id, evidence_code FROM education_verifications WHERE id IN ($1, $2) ORDER BY id",
        [currentId, legacyId],
      );
      expect(new Map(codes.rows.map((row) => [row.id, row.evidence_code]))).toEqual(new Map([
        [currentId, "ABCD1234EFGH5678"],
        [legacyId, "102509633215"],
      ]));
      const removedColumn = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
         WHERE table_name = 'education_verifications' AND column_name = 'evidence_url'`,
      );
      expect(removedColumn.rows[0]?.count).toBe("0");
      await expect(client.query(
        `UPDATE education_verifications SET evidence_code = 'invalid' WHERE id = $1`,
        [currentId],
      )).rejects.toMatchObject({ code: "23514" });
    });
  });
});
