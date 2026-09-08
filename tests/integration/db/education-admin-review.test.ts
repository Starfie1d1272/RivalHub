import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getEducationReviewQueue, normalizeEducationReviewQuery } from "../../../src/lib/education/admin-review";
import { createLocalPool } from "./harness/database";

function loadQueue(params: Record<string, string>) {
  return getEducationReviewQueue(normalizeEducationReviewQuery(new URLSearchParams(params)));
}

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

      const defaultQueue = await loadQueue({ q: marker });
      expect(defaultQueue.normalizedQuery).toMatchObject({ status: "pending", sort: "oldest", page: 1, pageSize: 25 });
      expect(defaultQueue.total).toBe(28);
      expect(defaultQueue.rows[0]?.displayName).toBe(`EducationReviewDisplay-${marker}`);
      expect(defaultQueue.totalPages).toBe(2);

      const byDisplayName = await loadQueue({ q: `EducationReviewDisplay-${marker}`, status: "all" });
      expect(byDisplayName.rows).toHaveLength(1);
      expect(byDisplayName.rows[0]?.displayName).toBe(`EducationReviewDisplay-${marker}`);

      const byEvidence = await loadQueue({ q: `${evidenceMarker}A001`, status: "all" });
      expect(byEvidence.rows).toHaveLength(1);
      expect(byEvidence.rows[0]?.status).toBe("approved");

      const byInstitution = await loadQueue({ q: secondInstitution.name, institution: secondInstitution.id, status: "all" });
      expect(byInstitution.rows.some((row) => row.institution === secondInstitution.name)).toBe(true);

      const approved = await loadQueue({ q: marker, status: "approved" });
      expect(approved.total).toBe(1);
      const graduated = await loadQueue({ q: marker, academic: "graduated", status: "all" });
      expect(graduated.rows.every((row) => row.academicStatus === "graduated")).toBe(true);

      const recentlyReviewed = await loadQueue({ q: marker, status: "all", sort: "recently_reviewed" });
      expect(recentlyReviewed.rows.slice(0, 2).map((row) => row.status)).toEqual(["approved", "rejected"]);
      expect(recentlyReviewed.rows.slice(2).every((row) => row.status === "pending")).toBe(true);

      const secondPage = await loadQueue({ q: marker, page: "2" });
      expect(secondPage.page).toBe(2);
      expect(secondPage.rows).toHaveLength(3);
      const clamped = await loadQueue({ q: marker, page: "999" });
      expect(clamped.page).toBe(2);
      expect(clamped.rows).toHaveLength(3);

      await pool.query("UPDATE education_verifications SET evidence_code = NULL WHERE id = $1", [verificationIds[0]]);
      const afterRetention = await loadQueue({ q: `${evidenceMarker}R001`, status: "all" });
      expect(afterRetention.total).toBe(0);

      await pool.query("UPDATE education_verifications SET status = 'approved', reviewed_at = $2 WHERE id = $1", [verificationIds[0], now]);
      const afterReview = await loadQueue({ q: marker });
      expect(afterReview.total).toBe(27);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [verificationIds]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await pool.end();
    }
  });

  it("builds active-data facets and a distinct latest-approved identity overview", async () => {
    const pool = createLocalPool({ max: 4 });
    const marker = randomUUID().slice(0, 8);
    const institutionIds = [randomUUID(), randomUUID(), randomUUID()];
    const userIds = [randomUUID(), randomUUID(), randomUUID()];
    const verificationIds = Array.from({ length: 5 }, () => randomUUID());

    try {
      const baseline = await loadQueue({ status: "all" });
      await pool.query(
        `INSERT INTO institutions (id, name, source, source_version)
         VALUES ($1, $4, 'manual', $7), ($2, $5, 'manual', $7), ($3, $6, 'manual', $7)`,
        [institutionIds[0], institutionIds[1], institutionIds[2], `A-${marker}`, `B-${marker}`, `Unused-${marker}`, `test-${marker}`],
      );
      await pool.query(
        `INSERT INTO users (id, email, display_name, perfect_name, steam_name)
         VALUES ($1, $4, NULL, $7, 'Steam A'), ($2, $5, NULL, $8, 'Steam B'), ($3, $6, 'Rejected user', NULL, NULL)`,
        [userIds[0], userIds[1], userIds[2], `${marker}-a@local.test`, `${marker}-b@local.test`, `${marker}-c@local.test`, `Perfect-${marker}-A`, `Perfect-${marker}-B`],
      );
      await pool.query(
        `INSERT INTO education_verifications
           (id, user_id, institution_id, academic_status, evidence_type, status, submitted_at)
         VALUES
           ($1, $6, $9, 'enrolled', 'manual_other', 'approved', '2026-09-01T00:00:00Z'),
           ($2, $6, $9, 'graduated', 'manual_other', 'approved', '2026-09-02T00:00:00Z'),
           ($3, $6, $10, 'enrolled', 'manual_other', 'approved', '2026-09-03T00:00:00Z'),
           ($4, $7, $9, 'enrolled', 'manual_other', 'approved', '2026-09-04T00:00:00Z'),
           ($5, $8, $10, 'graduated', 'manual_other', 'rejected', '2026-09-05T00:00:00Z')`,
        [...verificationIds, ...userIds, ...institutionIds.slice(0, 2)],
      );

      const queue = await loadQueue({ status: "all" });
      const aOption = queue.institutionOptions.find((item) => item.id === institutionIds[0]);
      const bOption = queue.institutionOptions.find((item) => item.id === institutionIds[1]);
      expect(aOption).toMatchObject({ name: `A-${marker}`, userCount: 2 });
      expect(bOption).toMatchObject({ name: `B-${marker}`, userCount: 2 });
      expect(queue.institutionOptions.findIndex((item) => item.id === institutionIds[0]))
        .toBeLessThan(queue.institutionOptions.findIndex((item) => item.id === institutionIds[1]));
      expect(queue.institutionOptions.some((item) => item.id === institutionIds[2])).toBe(false);

      expect(queue.overview.activeUserCount).toBe(baseline.overview.activeUserCount + 3);
      expect(queue.overview.approvedUserCount).toBe(baseline.overview.approvedUserCount + 2);
      expect(queue.overview.academicDistribution).toEqual({
        enrolled: baseline.overview.academicDistribution.enrolled + 2,
        graduated: baseline.overview.academicDistribution.graduated + 1,
      });
      expect(queue.overview.institutionDistribution.find((item) => item.id === institutionIds[0])).toMatchObject({ identityCount: 2 });
      expect(queue.overview.institutionDistribution.find((item) => item.id === institutionIds[1])).toMatchObject({ identityCount: 1 });

      const byPerfectName = await loadQueue({ q: `Perfect-${marker}-B`, status: "all" });
      expect(byPerfectName.rows).toHaveLength(1);
      expect(byPerfectName.rows[0]?.displayName).toBe(`Perfect-${marker}-B`);
    } finally {
      await pool.query("DELETE FROM education_verifications WHERE id = ANY($1::uuid[])", [verificationIds]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await pool.query("DELETE FROM institutions WHERE id = ANY($1::uuid[])", [institutionIds]).catch(() => {});
      await pool.end();
    }
  });
});
