import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEducationReviewQueue } from "../../../src/lib/education/admin-review";
import { createLocalPool } from "./harness/database";

describe("education review queue PostgreSQL read model", () => {
  it("filters, sorts, paginates, and stops matching evidence after retention cleanup", async () => {
    const pool = createLocalPool({ max: 4 });
    const marker = `education-review-${randomUUID()}`;
    const userIds: string[] = [];
    const verificationIds: string[] = [];
    const now = new Date("2026-09-06T00:00:00.000Z");
    const evidenceMarker = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

    try {
      const institutions = await pool.query<{ id: string; name: string }>("SELECT id, name FROM institutions ORDER BY name, id LIMIT 2");
      if (institutions.rows.length < 2) throw new Error("Local fixture 需要至少两条高校目录记录。");
      const firstInstitution = institutions.rows[0]!;
      const secondInstitution = institutions.rows[1]!;

      const baseRows = [
        { status: "pending", academicStatus: "enrolled", institutionId: firstInstitution.id, submittedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), reviewedAt: null, evidenceCode: `${evidenceMarker}R001`, displayName: `EducationReviewDisplay-${marker}` },
        { status: "pending", academicStatus: "graduated", institutionId: secondInstitution.id, submittedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), reviewedAt: null, evidenceCode: `${evidenceMarker}P001`, displayName: "Pending Newer" },
        { status: "approved", academicStatus: "graduated", institutionId: firstInstitution.id, submittedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), reviewedAt: new Date(now.getTime() - 60 * 60 * 1000), evidenceCode: `${evidenceMarker}A001`, displayName: "Approved Recently" },
        { status: "rejected", academicStatus: "enrolled", institutionId: secondInstitution.id, submittedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), reviewedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), evidenceCode: `${evidenceMarker}J001`, displayName: "Rejected Earlier" },
      ] as const;
      const extraRows = Array.from({ length: 26 }, (_, index) => ({
        status: "pending" as const,
        academicStatus: "enrolled" as const,
        institutionId: firstInstitution.id,
        submittedAt: new Date(now.getTime() - (index + 1) * 60 * 1000),
        reviewedAt: null,
        evidenceCode: `${evidenceMarker}${String(index).padStart(4, "0")}`,
        displayName: `Page User ${index}`,
      }));
      const rows = [...baseRows, ...extraRows];

      for (const [index, row] of rows.entries()) {
        const userId = randomUUID();
        const verificationId = randomUUID();
        userIds.push(userId);
        verificationIds.push(verificationId);
        await pool.query(
          "INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)",
          [userId, `${marker}-${index}@local.test`, row.displayName],
        );
        await pool.query(
          `INSERT INTO education_verifications
             (id, user_id, institution_id, academic_status, evidence_type,
              evidence_code, status, submitted_at, reviewed_at, review_note)
           VALUES ($1, $2, $3, $4, 'chsi_education_report', $5, $6, $7, $8, NULL)`,
          [verificationId, userId, row.institutionId, row.academicStatus, row.evidenceCode, row.status, row.submittedAt, row.reviewedAt],
        );
      }

      const defaultQueue = await getEducationReviewQueue(new URLSearchParams({ q: marker }));
      expect(defaultQueue.normalizedQuery).toMatchObject({ status: "pending", sort: "oldest", page: 1, pageSize: 25 });
      expect(defaultQueue.total).toBe(28);
      expect(defaultQueue.rows[0]?.displayName).toBe(`EducationReviewDisplay-${marker}`);
      expect(defaultQueue.totalPages).toBe(2);

      const byDisplayName = await getEducationReviewQueue(new URLSearchParams({ q: `EducationReviewDisplay-${marker}`, status: "all" }));
      expect(byDisplayName.rows).toHaveLength(1);
      expect(byDisplayName.rows[0]?.displayName).toBe(`EducationReviewDisplay-${marker}`);

      const byEvidence = await getEducationReviewQueue(new URLSearchParams({ q: `${evidenceMarker}A001`, status: "all" }));
      expect(byEvidence.rows).toHaveLength(1);
      expect(byEvidence.rows[0]?.status).toBe("approved");

      const byInstitution = await getEducationReviewQueue(new URLSearchParams({ q: secondInstitution.name, institution: secondInstitution.id, status: "all" }));
      expect(byInstitution.rows.some((row) => row.institution === secondInstitution.name)).toBe(true);

      const approved = await getEducationReviewQueue(new URLSearchParams({ q: marker, status: "approved" }));
      expect(approved.total).toBe(1);
      const graduated = await getEducationReviewQueue(new URLSearchParams({ q: marker, academic: "graduated", status: "all" }));
      expect(graduated.rows.every((row) => row.academicStatus === "graduated")).toBe(true);

      const recentlyReviewed = await getEducationReviewQueue(new URLSearchParams({ q: marker, status: "all", sort: "recently_reviewed" }));
      expect(recentlyReviewed.rows.slice(0, 2).map((row) => row.status)).toEqual(["approved", "rejected"]);
      expect(recentlyReviewed.rows.slice(2).every((row) => row.status === "pending")).toBe(true);

      const secondPage = await getEducationReviewQueue(new URLSearchParams({ q: marker, page: "2" }));
      expect(secondPage.page).toBe(2);
      expect(secondPage.rows).toHaveLength(3);
      const clamped = await getEducationReviewQueue(new URLSearchParams({ q: marker, page: "999" }));
      expect(clamped.page).toBe(2);
      expect(clamped.rows).toHaveLength(3);

      await pool.query("UPDATE education_verifications SET evidence_code = NULL WHERE id = $1", [verificationIds[0]]);
      const afterRetention = await getEducationReviewQueue(new URLSearchParams({ q: `${evidenceMarker}R001`, status: "all" }));
      expect(afterRetention.total).toBe(0);

      await pool.query("UPDATE education_verifications SET status = 'approved', reviewed_at = $2 WHERE id = $1", [verificationIds[0], now]);
      const afterReview = await getEducationReviewQueue(new URLSearchParams({ q: marker }));
      expect(afterReview.total).toBe(27);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [verificationIds]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await pool.end();
    }
  });
});
