import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getTeamRegistrationReview,
  getTeamRegistrationProgress,
  normalizeTeamRegistrationReviewQuery,
} from "../../../src/lib/registrations/admin-review";
import { normalizeTeamRegistrationConfig } from "../../../src/lib/seasons/compatibility";
import { createLocalPool } from "./harness/database";

describe("PR3 team registration review PostgreSQL integration", () => {
  it("filters and pages after canonical qualification projection", async () => {
    const pool = createLocalPool({ max: 4 });
    const ids = {
      season: randomUUID(),
      readyUser: randomUUID(),
      blockedUser: randomUUID(),
      readyEntry: randomUUID(),
      blockedEntry: randomUUID(),
      approvedEntry: randomUUID(),
      readyParticipant: randomUUID(),
      blockedParticipant: randomUUID(),
      approvedParticipant: randomUUID(),
      readyRevision: randomUUID(),
      blockedRevision: randomUUID(),
      approvedRevision: randomUUID(),
      readyMember: randomUUID(),
      blockedMember: randomUUID(),
      approvedMember: randomUUID(),
      override: randomUUID(),
      rosterBlock: randomUUID(),
      draftEntry: randomUUID(),
      olderDraftEntry: randomUUID(),
      draftParticipant: randomUUID(),
      olderDraftParticipant: randomUUID(),
      draftRevision: randomUUID(),
      olderDraftRevision: randomUUID(),
      draftMember: randomUUID(),
      olderDraftMember: randomUUID(),
    };
    const marker = `team-review-${ids.season}`;
    const now = Date.now();
    const institutionCode = "4132010284";
    const paginationEntries = Array.from({ length: 50 }, (_, index) => ({
      id: randomUUID(),
      userId: randomUUID(),
      participantId: randomUUID(),
      revisionId: randomUUID(),
      memberId: randomUUID(),
      ready: index % 2 === 0,
      index,
    }));

    try {
      const institution = await pool.query<{ id: string }>(
        "SELECT id FROM institutions WHERE moe_institution_code = $1",
        [institutionCode],
      );
      const institutionId = institution.rows[0]?.id;
      if (!institutionId) throw new Error("team review fixture 缺少学校目录基线。");

      await pool.query(
        `INSERT INTO seasons (
           id, slug, name, kind, competition_template, status, registration_mode,
           has_captain_voting, has_draft, team_registration_config, affiliation_rules,
           min_team_size, max_team_size, starter_count
         ) VALUES ($1, $2, $3, 'Major', 'major', 'registration', 'team', false, false, '{}'::json, $4::json, 1, 5, 1)`,
        [
          ids.season,
          `${marker}-season`,
          `PR3 Team Review ${marker}`,
          JSON.stringify([{
            institutionCode,
            eligibleAcademicStatuses: ["enrolled"],
            minRosterMembers: 1,
            minStartingMembers: 1,
          }]),
        ],
      );
      await pool.query(
        `INSERT INTO users (id, email, email_verified_at, display_name, perfect_name, steam_name)
         VALUES ($1, $2, now(), 'Ready Representative', 'Ready Perfect', 'Ready Steam'),
                ($3, $4, now(), 'Blocked Representative', 'Blocked Perfect', 'Blocked Steam')`,
        [
          ids.readyUser,
          `${marker}-ready@local.test`,
          ids.blockedUser,
          `${marker}-blocked@local.test`,
        ],
      );
      await pool.query(
        `INSERT INTO education_verifications (
           user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at
         ) VALUES ($1, $2, 'enrolled', 'manual_other', 'approved', 'pr3-team-review', now())`,
        [ids.readyUser, institutionId],
      );
      for (const entry of paginationEntries) {
        await pool.query(
          `INSERT INTO users (id, email, email_verified_at, display_name, perfect_name, steam_name)
           VALUES ($1, $2, now(), $3, $4, $5)`,
          [
            entry.userId,
            `${marker}-pagination-${entry.index}@local.test`,
            `${marker} Pagination Representative ${entry.index}`,
            `${marker} Pagination Perfect ${entry.index}`,
            `${marker} Pagination Steam ${entry.index}`,
          ],
        );
        if (entry.ready) {
          await pool.query(
            `INSERT INTO education_verifications (
               user_id, institution_id, academic_status, evidence_type, status, reviewed_by, reviewed_at
             ) VALUES ($1, $2, 'enrolled', 'manual_other', 'approved', 'pr3-team-review', now())`,
            [entry.userId, institutionId],
          );
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET CONSTRAINTS ALL DEFERRED");
        const submittedAt = {
          ready: new Date(now - 4 * 60 * 60 * 1000),
          blocked: new Date(now - 3 * 60 * 60 * 1000),
          approved: new Date(now - 2 * 60 * 60 * 1000),
        };
        const createdAt = {
          ready: new Date(now - 5 * 60 * 60 * 1000),
          blocked: new Date(now - 60 * 60 * 1000),
          approved: new Date(now - 30 * 60 * 60 * 1000),
        };
        const updatedAt = {
          ready: new Date(now - 60 * 60 * 1000),
          blocked: new Date(now - 4 * 60 * 60 * 1000),
          approved: new Date(now - 2 * 60 * 60 * 1000),
        };
        await client.query(
          `INSERT INTO competition_entries (
             id, competition_id, source, name, representative_user_id,
             current_roster_revision_id, approved_roster_revision_id,
             registration_status, submitted_at, created_at, updated_at
           ) VALUES
             ($1, $2, 'event_native', $3, $4, $5, NULL, 'submitted', $6, $7, $8),
             ($9, $2, 'event_native', $10, $11, $12, NULL, 'submitted', $13, $14, $15),
             ($16, $2, 'event_native', $17, $18, $19, $19, 'approved', $20, $21, $22)`,
          [
            ids.readyEntry,
            ids.season,
            `${marker} Ready Entry`,
            ids.readyUser,
            ids.readyRevision,
            submittedAt.ready,
            createdAt.ready,
            updatedAt.ready,
            ids.blockedEntry,
            `${marker} Blocked Entry`,
            ids.blockedUser,
            ids.blockedRevision,
            submittedAt.blocked,
            createdAt.blocked,
            updatedAt.blocked,
            ids.approvedEntry,
            `${marker} Approved Entry`,
            ids.readyUser,
            ids.approvedRevision,
            submittedAt.approved,
            createdAt.approved,
            updatedAt.approved,
          ],
        );
        await client.query(
          `INSERT INTO competition_entries (
             id, competition_id, source, name, representative_user_id,
             current_roster_revision_id, registration_status, created_at, updated_at
           ) VALUES
             ($1, $2, 'event_native', $3, $4, $5, 'draft', $6, $6),
             ($7, $2, 'event_native', $8, $9, $10, 'draft', $11, $11)`,
          [
            ids.draftEntry, ids.season, `${marker} Recent Draft`, ids.blockedUser, ids.draftRevision, new Date(now),
            ids.olderDraftEntry, `${marker} Older Draft`, ids.readyUser, ids.olderDraftRevision, new Date(now - 10 * 60 * 60 * 1000),
          ],
        );
        await client.query(
          `INSERT INTO competition_entry_representative_changes (
             entry_id, from_user_id, to_user_id, changed_by_actor_id
           ) VALUES ($1, NULL, $2, 'pr3-team-review'),
                    ($3, NULL, $4, 'pr3-team-review'),
                    ($5, NULL, $6, 'pr3-team-review')`,
          [ids.readyEntry, ids.readyUser, ids.blockedEntry, ids.blockedUser, ids.approvedEntry, ids.readyUser],
        );
        await client.query(
          `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
           VALUES ($1, NULL, $2, 'pr3-team-review'), ($3, NULL, $4, 'pr3-team-review')`,
          [ids.draftEntry, ids.blockedUser, ids.olderDraftEntry, ids.readyUser],
        );
        await client.query(
          `INSERT INTO competition_entry_participants (
             id, entry_id, user_id, status, confirmed_at, invited_by_user_id
           ) VALUES ($1, $2, $3, 'confirmed', now(), $3),
                    ($4, $5, $6, 'confirmed', now(), $6),
                    ($7, $8, $9, 'confirmed', now(), $9)`,
          [
            ids.readyParticipant, ids.readyEntry, ids.readyUser,
            ids.blockedParticipant, ids.blockedEntry, ids.blockedUser,
            ids.approvedParticipant, ids.approvedEntry, ids.readyUser,
          ],
        );
        await client.query(
          `INSERT INTO competition_entry_participants (id, entry_id, user_id, status, invited_by_user_id, confirmed_at)
           VALUES ($1, $2, $3, 'invited', $3, NULL), ($4, $5, $6, 'confirmed', $6, now())`,
          [ids.draftParticipant, ids.draftEntry, ids.blockedUser, ids.olderDraftParticipant, ids.olderDraftEntry, ids.readyUser],
        );
        await client.query(
          `INSERT INTO competition_entry_roster_revisions (
             id, entry_id, revision_number, status, created_by
           ) VALUES ($1, $2, 1, 'submitted', 'pr3-team-review'),
                    ($3, $4, 1, 'submitted', 'pr3-team-review'),
                    ($5, $6, 1, 'approved', 'pr3-team-review')`,
          [
            ids.readyRevision, ids.readyEntry,
            ids.blockedRevision, ids.blockedEntry,
            ids.approvedRevision, ids.approvedEntry,
          ],
        );
        await client.query(
          `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by)
           VALUES ($1, $2, 1, 'draft', 'pr3-team-review'), ($3, $4, 1, 'draft', 'pr3-team-review')`,
          [ids.draftRevision, ids.draftEntry, ids.olderDraftRevision, ids.olderDraftEntry],
        );
        await client.query(
          `INSERT INTO competition_entry_roster_members (
             id, revision_id, participant_id, user_id, is_primary_starter
           ) VALUES ($1, $2, $3, $4, true),
                    ($5, $6, $7, $8, true),
                    ($9, $10, $11, $12, true)`,
          [
            ids.readyMember, ids.readyRevision, ids.readyParticipant, ids.readyUser,
            ids.blockedMember, ids.blockedRevision, ids.blockedParticipant, ids.blockedUser,
            ids.approvedMember, ids.approvedRevision, ids.approvedParticipant, ids.readyUser,
          ],
        );
        await client.query(
          `INSERT INTO competition_entry_roster_members (id, revision_id, participant_id, user_id, is_primary_starter)
           VALUES ($1, $2, $3, $4, true), ($5, $6, $7, $8, true)`,
          [
            ids.draftMember, ids.draftRevision, ids.draftParticipant, ids.blockedUser,
            ids.olderDraftMember, ids.olderDraftRevision, ids.olderDraftParticipant, ids.readyUser,
          ],
        );
        // Keep 25 derived-ready and 25 derived-blocked entries older than the
        // named fixtures below. This makes each derived qualification filter
        // cross its 25-row page boundary and preserves a deterministic page 2.
        for (const entry of paginationEntries) {
          const submittedAt = new Date(now - (1_000 + entry.index) * 60 * 1000);
          await client.query(
            `INSERT INTO competition_entries (
               id, competition_id, source, name, representative_user_id,
               current_roster_revision_id, registration_status, submitted_at, created_at, updated_at
             ) VALUES ($1, $2, 'event_native', $3, $4, $5, 'submitted', $6, $6, $6)`,
            [entry.id, ids.season, `${marker} Pagination ${entry.index}`, entry.userId, entry.revisionId, submittedAt],
          );
          await client.query(
            `INSERT INTO competition_entry_representative_changes (
               entry_id, from_user_id, to_user_id, changed_by_actor_id
             ) VALUES ($1, NULL, $2, 'pr3-team-review')`,
            [entry.id, entry.userId],
          );
          await client.query(
            `INSERT INTO competition_entry_participants (
               id, entry_id, user_id, status, confirmed_at, invited_by_user_id
             ) VALUES ($1, $2, $3, 'confirmed', now(), $3)`,
            [entry.participantId, entry.id, entry.userId],
          );
          await client.query(
            `INSERT INTO competition_entry_roster_revisions (
               id, entry_id, revision_number, status, created_by
             ) VALUES ($1, $2, 1, 'submitted', 'pr3-team-review')`,
            [entry.revisionId, entry.id],
          );
          await client.query(
            `INSERT INTO competition_entry_roster_members (
               id, revision_id, participant_id, user_id, is_primary_starter
             ) VALUES ($1, $2, $3, $4, true)`,
            [entry.memberId, entry.revisionId, entry.participantId, entry.userId],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await pool.query(
        `INSERT INTO competition_entry_restriction_overrides (
           id, competition_id, entry_id, roster_revision_id, restriction_code,
           finding_snapshot, reason, granted_by
         ) VALUES ($1, $2, $3, $4, 'education_incomplete', $5::jsonb, '旧资格快照仅用于审计', 'pr3-team-review')`,
        [
          ids.override,
          ids.season,
          ids.blockedEntry,
          ids.blockedRevision,
          JSON.stringify({
            code: "education_incomplete",
            message: "旧快照",
            waivable: false,
            metadata: { field: "stale" },
          }),
        ],
      );
      await pool.query(
        `INSERT INTO disciplinary_cases (
           id, season_id, subject_user_id, status, effects, public_explanation, effective_from, issued_by
         ) VALUES ($1, $2, $3, 'active', '["roster_block"]'::jsonb, 'fixture roster block', now() - interval '1 minute', 'pr3-team-review')`,
        [ids.rosterBlock, ids.season, ids.blockedUser],
      );

      const season = {
        id: ids.season,
        teamRegistrationConfig: normalizeTeamRegistrationConfig({ requireTeamLogo: true }),
        affiliationRules: [{
          institutionCode,
          eligibleAcademicStatuses: ["enrolled" as const],
          minRosterMembers: 1,
          minStartingMembers: 1,
        }],
        minTeamSize: 1,
        maxTeamSize: 5,
        starterCount: 1,
      };
      const review = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams()),
      );
      expect(review).toMatchObject({ total: 52, page: 1, pageSize: 25, totalPages: 3, hasAnyRecords: true });

      const progress = await getTeamRegistrationProgress(season);
      expect(progress.summary).toMatchObject({ total: 55, draft: 2, submitted: 52, approved: 1, changesRequested: 0 });
      expect(progress.drafts.map((row) => row.id)).toEqual([ids.draftEntry, ids.olderDraftEntry]);
      expect(progress.drafts[0]).toMatchObject({ rosterCount: 1, confirmedCount: 0, starterCount: 1, requiredStarterCount: 1 });
      expect(progress.drafts[0]?.primaryBlockers).toContain("所有名单成员都需确认代表本届赛事参赛。");
      expect(progress.drafts[0]?.primaryBlockers).toContain("以下成员当前不能进入赛事名单：Blocked Perfect");

      const newest = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ sort: "newest_updated" })),
      );
      expect(newest.rows[0]?.id).toBe(ids.readyEntry);

      const byStatus = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ status: "approved" })),
      );
      expect(byStatus.total).toBe(1);
      expect(byStatus.rows[0]?.id).toBe(ids.approvedEntry);

      const bySearch = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ q: "Blocked Representative" })),
      );
      expect(bySearch.total).toBe(1);
      expect(bySearch.rows[0]?.id).toBe(ids.blockedEntry);
      expect(bySearch.rows[0]?.qualificationFindings.length).toBeGreaterThan(0);
      expect(bySearch.rows[0]?.activeRestrictionOverrides).toEqual([
        expect.objectContaining({ id: ids.override, snapshotMatches: false }),
      ]);

      const ready = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ qualification: "ready" })),
      );
      const blocked = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ qualification: "blocked" })),
      );
      expect(ready).toMatchObject({ total: 26, page: 1, pageSize: 25, totalPages: 2 });
      expect(blocked).toMatchObject({ total: 26, page: 1, pageSize: 25, totalPages: 2 });
      const readyPageTwo = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ qualification: "ready", page: "2" })),
      );
      const blockedPageTwo = await getTeamRegistrationReview(
        season,
        normalizeTeamRegistrationReviewQuery(new URLSearchParams({ qualification: "blocked", page: "2" })),
      );
      expect(readyPageTwo).toMatchObject({ total: 26, page: 2, pageSize: 25, totalPages: 2 });
      expect(readyPageTwo.rows.map((row) => row.id)).toEqual([ids.readyEntry]);
      expect(blockedPageTwo).toMatchObject({ total: 26, page: 2, pageSize: 25, totalPages: 2 });
      expect(blockedPageTwo.rows.map((row) => row.id)).toEqual([ids.blockedEntry]);
    } finally {
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SET LOCAL session_replication_role = replica");
        await cleanup.query("DELETE FROM competition_entry_restriction_overrides WHERE id = $1", [ids.override]);
        await cleanup.query("DELETE FROM disciplinary_cases WHERE id = $1", [ids.rosterBlock]);
        await cleanup.query("DELETE FROM competition_entry_roster_members WHERE id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.memberId), ids.readyMember, ids.blockedMember, ids.approvedMember, ids.draftMember, ids.olderDraftMember]]);
        await cleanup.query("DELETE FROM competition_entry_participants WHERE id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.participantId), ids.readyParticipant, ids.blockedParticipant, ids.approvedParticipant, ids.draftParticipant, ids.olderDraftParticipant]]);
        await cleanup.query("DELETE FROM competition_entry_roster_revisions WHERE id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.revisionId), ids.readyRevision, ids.blockedRevision, ids.approvedRevision, ids.draftRevision, ids.olderDraftRevision]]);
        await cleanup.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.id), ids.readyEntry, ids.blockedEntry, ids.approvedEntry, ids.draftEntry, ids.olderDraftEntry]]);
        await cleanup.query("DELETE FROM competition_entries WHERE id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.id), ids.readyEntry, ids.blockedEntry, ids.approvedEntry, ids.draftEntry, ids.olderDraftEntry]]);
        await cleanup.query("DELETE FROM education_verifications WHERE user_id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.userId), ids.readyUser, ids.blockedUser]]);
        await cleanup.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
        await cleanup.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[...paginationEntries.map((entry) => entry.userId), ids.readyUser, ids.blockedUser]]);
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        cleanup.release();
      }
      await pool.end();
    }
  });
});
