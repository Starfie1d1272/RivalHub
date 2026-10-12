import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEducationReviewQueue, normalizeEducationReviewQuery } from "../../../src/lib/education/admin-review";
import { createLocalPool } from "./harness/database";

function loadQueue(params: Record<string, string>) {
  return getEducationReviewQueue(normalizeEducationReviewQuery(new URLSearchParams(params)));
}

describe("education review queue PostgreSQL read model", () => {
  it("withholds expired evidence and its search matches before physical cleanup, preserving review history", async () => {
    const pool = createLocalPool();
    const marker = `expiry-${randomUUID()}`;
    const institutionId = randomUUID();
    const userIds = Array.from({ length: 3 }, () => randomUUID());
    const ids = Array.from({ length: 3 }, () => randomUUID());
    const codes = [randomUUID(), randomUUID()].map(value => value.replaceAll("-", "").slice(0, 16).toUpperCase());
    try {
      await pool.query("INSERT INTO institutions (id,name,source,source_version) VALUES ($1,$2,'manual','fixture')", [institutionId, marker]);
      for (const id of userIds) await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, `${id}@local.test`, marker]);
      await pool.query(`INSERT INTO education_verifications (id,user_id,institution_id,academic_status,evidence_type,status,evidence_code,evidence_object_key,reviewed_at) VALUES
        ($1,$4,$7,'enrolled','chsi_enrollment_report','pending',$8,NULL,NULL),
        ($2,$5,$7,'enrolled','chsi_enrollment_report','approved',$9,NULL,now()-interval '8 days'),
        ($3,$6,$7,'enrolled','manual_other','rejected',NULL,'private-fixture-key',now()-interval '8 days')`, [...ids,...userIds,institutionId,...codes]);
      const queue = await loadQueue({ q: marker, status: "all" });
      const byId = new Map(queue.rows.map(row => [row.id,row]));
      expect(byId.get(ids[0]!)).toMatchObject({ chsiEvidenceCode: codes[0] });
      expect(byId.get(ids[1]!)).toMatchObject({ chsiEvidenceCode: null, status: "approved" });
      expect(byId.get(ids[2]!)).toMatchObject({ manualEvidenceAvailable: false, status: "rejected" });
      expect((await loadQueue({ q: codes[1]!, status: "all" })).total).toBe(0);
      expect((await loadQueue({ q: codes[0]!, status: "all" })).total).toBe(1);
      expect((await pool.query("SELECT evidence_code,evidence_object_key FROM education_verifications WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows).toHaveLength(3);
      expect((await pool.query("SELECT evidence_code FROM education_verifications WHERE id=$1", [ids[1]])).rows[0].evidence_code).toBe(codes[1]);
      expect(JSON.stringify(queue)).not.toContain("private-fixture-key");
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM institutions WHERE id=$1", [institutionId]);
      await pool.end();
    }
  });
});
