import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getAdminInviteHistory, normalizeAdminInviteQuery } from "../../../src/lib/admin/invites";
import { getAdminUsersList, normalizeAdminUsersQuery } from "../../../src/lib/admin/users";
import {
  getSeasonSanctionsAdminReadModel,
  normalizeDisciplineAdminQuery,
} from "../../../src/lib/discipline/admin-review";
import {
  getSoloRegistrationReview,
  normalizeSoloRegistrationReviewQuery,
} from "../../../src/lib/registrations/admin-review";
import { createLocalPool } from "./harness/database";

describe("PR3 admin operational list read models", () => {
  it("uses PostgreSQL counts, claim aggregation, resolved status, and bounded pages", async () => {
    const pool = createLocalPool({ max: 8 });
    const marker = `pr3-${randomUUID().replaceAll("-", "")}`;
    const seasonId = randomUUID();
    const userIds = Array.from({ length: 52 }, () => randomUUID());
    const registrationIds = Array.from({ length: 26 }, () => randomUUID());
    const inviteIds = Array.from({ length: 5 }, () => randomUUID());
    const caseIds = Array.from({ length: 3 }, () => randomUUID());
    const now = new Date();

    try {
      await pool.query(
        `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, positions)
         VALUES ($1, $2, $3, 'Rivals', 'registration', 'solo', $4::text[])`,
        [seasonId, `${marker}-season`, `PR3 ${marker}`, ["rifler", "awper"]],
      );

      for (const [index, userId] of userIds.entries()) {
        await pool.query(
          `INSERT INTO users (id, email, display_name, perfect_name, steam_name, steam_profile_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            `${marker}-${index}@local.test`,
            `${marker} player ${index}`,
            `${marker} perfect ${index}`,
            `${marker} steam ${index}`,
            index === 0 ? "https://steamcommunity.com/id/pr3-player/?ref=fixture" : null,
          ],
        );
      }

      for (const [index, registrationId] of registrationIds.entries()) {
        const createdAt = new Date(now.getTime() - (index + 1) * 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO season_registrations (
             id, user_id, season_id, primary_position, secondary_position,
             peak_rank, peak_rank_season, peak_rating,
             current_season_peak_rank, current_rating, gameplay_style,
             created_at, updated_at
           ) VALUES ($1, $2, $3, 'rifler', 'awper', 'A+', 'PR3', 1.5, 'A', 1.4, '稳健', $4, $4)`,
          [registrationId, userIds[index], seasonId, createdAt],
        );
      }

      const inviteFixtures = [
        { id: inviteIds[0], code: `${marker}-usable`, maxUses: 2, expiresAt: new Date(now.getTime() + 60 * 60 * 1000), isActive: true },
        { id: inviteIds[1], code: `${marker}-expired`, maxUses: 1, expiresAt: new Date(now.getTime() - 60 * 60 * 1000), isActive: true },
        { id: inviteIds[2], code: `${marker}-exhausted`, maxUses: 1, expiresAt: null, isActive: true },
        { id: inviteIds[3], code: `${marker}-revoked`, maxUses: 2, expiresAt: null, isActive: false },
      ] as const;
      for (const [index, invite] of inviteFixtures.entries()) {
        await pool.query(
          `INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, expires_at, is_active, created_at)
           VALUES ($1, $2, $3, 'season_admin', $4, $5, $6, $7, $8)`,
          [invite.id, invite.code, userIds[0], seasonId, invite.maxUses, invite.expiresAt, invite.isActive, new Date(now.getTime() - (index + 1) * 60 * 1000)],
        );
      }
      await pool.query(
        `INSERT INTO admin_invite_claims (invite_id, user_id) VALUES ($1, $2)`,
        [inviteIds[2], userIds[1]],
      );
      await pool.query(
        `INSERT INTO admin_invites (id, code, created_by, role, season_id, max_uses, created_at)
         VALUES ($1, $2, $3, 'super_admin', NULL, 1, $4)`,
        [inviteIds[4], `${marker}-global`, userIds[0], now],
      );

      const disciplineFixtures = [
        {
          id: caseIds[0],
          status: "active",
          effectiveFrom: new Date(now.getTime() - 3 * 60 * 60 * 1000),
          effectiveUntil: null,
          revokedAt: null,
          reason: null,
        },
        {
          id: caseIds[1],
          status: "active",
          effectiveFrom: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          effectiveUntil: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          revokedAt: null,
          reason: null,
        },
        {
          id: caseIds[2],
          status: "revoked",
          effectiveFrom: new Date(now.getTime() - 4 * 60 * 60 * 1000),
          effectiveUntil: null,
          revokedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          reason: "测试撤销",
        },
      ] as const;
      for (const [index, sanction] of disciplineFixtures.entries()) {
        await pool.query(
          `INSERT INTO disciplinary_cases (
             id, season_id, subject_user_id, status, effects, internal_evidence,
             public_explanation, effective_from, effective_until, issued_by,
             revoked_at, revoked_by, revocation_reason, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, '["registration_block"]'::jsonb, $5, $6, $7, $8, 'pr3-test', $9, $10, $11, $12, $12)`,
          [
            sanction.id,
            seasonId,
            userIds[index],
            sanction.status,
            `${marker} internal evidence`,
            `${marker} public explanation`,
            sanction.effectiveFrom,
            sanction.effectiveUntil,
            sanction.revokedAt,
            sanction.revokedAt ? "pr3-test" : null,
            sanction.reason,
            new Date(now.getTime() - (index + 1) * 30 * 60 * 1000),
          ],
        );
      }

      const inviteHistory = await getAdminInviteHistory(normalizeAdminInviteQuery(new URLSearchParams({
        season: seasonId,
        sort: "expires_soon",
      })));
      expect(inviteHistory.total).toBe(4);
      expect(inviteHistory.rows.map((row) => row.state)).toEqual([
        "expired",
        "usable",
        "exhausted",
        "revoked",
      ]);
      expect(inviteHistory.rows[2]?.claimCount).toBe(1);
      expect(inviteHistory.hasAnyRecords).toBe(true);
      const exhausted = await getAdminInviteHistory(normalizeAdminInviteQuery(new URLSearchParams({
        season: seasonId,
        state: "exhausted",
      })));
      expect(exhausted.total).toBe(1);

      const usersPage = await getAdminUsersList(normalizeAdminUsersQuery(new URLSearchParams({ q: marker })));
      expect(usersPage.total).toBe(52);
      expect(usersPage.rows).toHaveLength(50);
      expect(usersPage.totalPages).toBe(2);
      const usersSecondPage = await getAdminUsersList(normalizeAdminUsersQuery(new URLSearchParams({ q: marker, page: "2" })));
      expect(usersSecondPage.page).toBe(2);
      expect(usersSecondPage.rows).toHaveLength(2);
      const participated = await getAdminUsersList(normalizeAdminUsersQuery(new URLSearchParams({ q: marker, filter: "participated" })));
      expect(participated.total).toBe(26);
      const notParticipated = await getAdminUsersList(normalizeAdminUsersQuery(new URLSearchParams({ q: marker, filter: "none" })));
      expect(notParticipated.total).toBe(26);

      const sanctions = await getSeasonSanctionsAdminReadModel(
        seasonId,
        normalizeDisciplineAdminQuery(new URLSearchParams({ q: marker, status: "all" })),
      );
      expect(sanctions.total).toBe(3);
      const revokedSanction = sanctions.rows.find((row) => row.id === caseIds[2]);
      expect(revokedSanction?.resolvedStatus).toBe("revoked");
      expect(revokedSanction?.subjectLabel).toContain(marker);
      expect(revokedSanction?.internalEvidence).toContain("internal evidence");
      const activeSanctions = await getSeasonSanctionsAdminReadModel(
        seasonId,
        normalizeDisciplineAdminQuery(new URLSearchParams({ q: marker })),
      );
      expect(activeSanctions.total).toBe(1);
      const expiredSanctions = await getSeasonSanctionsAdminReadModel(
        seasonId,
        normalizeDisciplineAdminQuery(new URLSearchParams({ q: marker, status: "expired" })),
      );
      expect(expiredSanctions.total).toBe(1);

      const registrationQuery = normalizeSoloRegistrationReviewQuery(
        new URLSearchParams({ q: marker, status: "all" }),
        ["rifler", "awper"],
      );
      const registrations = await getSoloRegistrationReview(seasonId, ["rifler", "awper"], registrationQuery);
      expect(registrations.total).toBe(26);
      expect(registrations.rows).toHaveLength(25);
      expect(registrations.totalPages).toBe(2);
      expect(registrations.rows[0]?.steamProfileUrl).toBe("https://steamcommunity.com/id/pr3-player");
      const registrationsSecondPage = await getSoloRegistrationReview(
        seasonId,
        ["rifler", "awper"],
        normalizeSoloRegistrationReviewQuery(new URLSearchParams({ q: marker, status: "all", page: "2" }), ["rifler", "awper"]),
      );
      expect(registrationsSecondPage.page).toBe(2);
      expect(registrationsSecondPage.rows).toHaveLength(1);
      const byPosition = await getSoloRegistrationReview(
        seasonId,
        ["rifler", "awper"],
        normalizeSoloRegistrationReviewQuery(new URLSearchParams({ q: marker, status: "all", position: "rifler" }), ["rifler", "awper"]),
      );
      expect(byPosition.total).toBe(26);
    } finally {
      await pool.query("DELETE FROM disciplinary_cases WHERE id = ANY($1::uuid[])", [caseIds]).catch(() => {});
      await pool.query("DELETE FROM season_registrations WHERE id = ANY($1::uuid[])", [registrationIds]).catch(() => {});
      await pool.query("DELETE FROM admin_invites WHERE id = ANY($1::uuid[])", [inviteIds]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]).catch(() => {});
      await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]).catch(() => {});
      await pool.end();
    }
  });
});
