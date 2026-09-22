import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitAdmissionNoticeEducation } from "../../../src/actions/education-verifications";
import { createLocalPool } from "./harness/database";

const { requireAuthMock, auditActorIdMock, uploadMock, removeMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  auditActorIdMock: vi.fn((session: { userId: string }) => session.userId),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSuperAdmin: vi.fn(),
  auditActorId: auditActorIdMock,
}));
vi.mock("@/lib/education/storage", () => ({
  educationEvidenceStorage: {
    upload: uploadMock,
    remove: removeMock,
    createSignedUrl: vi.fn(),
  },
}));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function manualForm(institutionId: string): FormData {
  const form = new FormData();
  form.set("institutionId", institutionId);
  form.set("file", new File([PNG_SIGNATURE], "original-name-with-pii.png", { type: "image/png" }));
  return form;
}

describe("manual education verification PostgreSQL workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditActorIdMock.mockImplementation((session: { userId: string }) => session.userId);
    uploadMock.mockResolvedValue(undefined);
    removeMock.mockResolvedValue(undefined);
  });

  it("serializes concurrent submissions, allows rejected resubmission, and stops after approval", async () => {
    const pool = createLocalPool({ max: 4 });
    const userId = randomUUID();
    const email = `education-manual-${userId}@local.test`;
    const session = { userId, email };

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      const institutionId = institution.rows[0].id;
      await pool.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
      requireAuthMock.mockResolvedValue(session);
      uploadMock.mockResolvedValue(undefined);
      removeMock.mockResolvedValue(undefined);

      const concurrent = await Promise.all([
        submitAdmissionNoticeEducation(manualForm(institutionId)),
        submitAdmissionNoticeEducation(manualForm(institutionId)),
      ]);
      expect(concurrent.map((result) => result.success ? result.data : result.error.code).sort()).toEqual(["already_pending", "created"]);
      expect(uploadMock).toHaveBeenCalledTimes(1);

      const first = await pool.query<{ id: string; evidence_object_key: string; evidence_code: string | null; status: string }>(
        `SELECT id, evidence_object_key, evidence_code, status::text AS status
         FROM education_verifications WHERE user_id = $1`,
        [userId],
      );
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({ evidence_code: null, status: "pending" });
      expect(first.rows[0]?.evidence_object_key).toMatch(new RegExp(`^[0-9a-f-]{36}/[0-9a-f-]{36}\\.png$`));
      expect(first.rows[0]?.evidence_object_key).not.toContain(email);
      expect(first.rows[0]?.evidence_object_key).not.toContain("original-name-with-pii");

      const audit = await pool.query<{ meta: Record<string, unknown> }>(
        "SELECT meta FROM audit_logs WHERE actor_id = $1 AND action = 'education_verification.submit' AND target_id = $2",
        [userId, first.rows[0]!.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.meta).toEqual({ institutionId, evidenceType: "manual_other" });

      await pool.query(
        "UPDATE education_verifications SET status = 'rejected', reviewed_by = 'local-admin', reviewed_at = now(), review_note = '材料不清晰' WHERE id = $1",
        [first.rows[0]!.id],
      );
      await expect(submitAdmissionNoticeEducation(manualForm(institutionId))).resolves.toEqual({ success: true, data: "created" });
      expect(uploadMock).toHaveBeenCalledTimes(2);

      const second = await pool.query<{ id: string; status: string }>(
        "SELECT id, status::text AS status FROM education_verifications WHERE user_id = $1 ORDER BY created_at, id",
        [userId],
      );
      expect(second.rows).toHaveLength(2);
      expect(second.rows.map((row) => row.status)).toEqual(["rejected", "pending"]);

      await pool.query(
        "UPDATE education_verifications SET status = 'approved', reviewed_by = 'local-admin', reviewed_at = now() WHERE id = $1",
        [second.rows[1]!.id],
      );
      await expect(submitAdmissionNoticeEducation(manualForm(institutionId))).resolves.toEqual({ success: true, data: "already_approved" });
      expect(uploadMock).toHaveBeenCalledTimes(2);
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM education_verifications WHERE user_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });

  it("compensates a successfully uploaded object when the transaction cannot commit", async () => {
    const pool = createLocalPool({ max: 2 });
    const userId = randomUUID();
    const email = `education-manual-failure-${userId}@local.test`;

    try {
      const institution = await pool.query<{ id: string }>("SELECT id FROM institutions ORDER BY id LIMIT 1");
      if (!institution.rows[0]) throw new Error("Local fixture 需要高校目录记录。");
      await pool.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())", [userId, email]);
      requireAuthMock.mockResolvedValue({ userId, email });
      uploadMock.mockImplementation(async (objectKey: string) => {
        const verificationId = objectKey.split("/", 1)[0];
        await pool.query(
          `INSERT INTO education_verifications
             (id, user_id, institution_id, academic_status, evidence_type, evidence_object_key, status, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, 'enrolled', 'manual_other', $4, 'approved', 'local-conflict', now())`,
          [verificationId, userId, institution.rows[0].id, objectKey],
        );
      });

      await expect(submitAdmissionNoticeEducation(manualForm(institution.rows[0].id))).resolves.toMatchObject({
        success: false,
        error: { code: "INTERNAL_ERROR" },
      });
      expect(uploadMock).toHaveBeenCalledTimes(1);
      expect(removeMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/));
      await expect(pool.query("SELECT count(*)::text AS count FROM education_verifications WHERE user_id = $1", [userId])).resolves.toMatchObject({ rows: [{ count: "1" }] });
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM education_verifications WHERE user_id = $1", [userId]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
      await pool.end();
    }
  });
});
