import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSeasonAdmin: vi.fn(async () => ({ userId: auth.userId })),
  requireAuth: vi.fn(async () => ({ userId: auth.userId })),
}));
vi.mock("@/lib/revalidation", () => ({ revalidateSeasonPaths: vi.fn() }));

import { castVote, confirmCaptains, retractVote } from "@/actions/captains";
import { pickPlayer } from "@/actions/draft/picks";
import { getEntryIdForRepresentative } from "@/actions/matches/_shared";
import { getAdminCaptainRanking } from "@/lib/captains/data";
import { getPublicDraftData, getPublicDraftSummary } from "@/lib/draft/data";

it("forms canonical captain Entries and commits a draft pick without losing identity provenance", async () => {
  const pool = createLocalPool();
  const seasonId = randomUUID();
  const players = Array.from({ length: 10 }, (_, index) => ({ userId: randomUUID(), registrationId: randomUUID(), index }));
  const voter = players[9]!;
  auth.userId = players[0]!.userId;
  // The suite owns an isolated worker database; lifecycle rows intentionally
  // commit so real Server Actions observe them through their normal DB client.
  try {
    await pool.query(`INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft)
      VALUES ($1, $2, 'Rivals identity flow', 'Rivals', 'voting', 'solo', true, true)`, [seasonId, `rivals-${seasonId}`]);
    for (const player of players) {
      await pool.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)", [player.userId, `${player.userId}@local.test`, `Player ${player.index}`]);
      await pool.query(`INSERT INTO season_registrations
        (id, user_id, season_id, primary_position, secondary_position, peak_rank, peak_rank_season, peak_rating, current_season_peak_rank, current_rating, gameplay_style, status, willing_to_be_captain)
        VALUES ($1, $2, $3, 'opener', 'anchor', 'A', 'current', $4, 'A', 1, '', 'approved', $5)`,
      [player.registrationId, player.userId, seasonId, 2 - player.index / 10, player.index < 9]);
    }
    async function currentConfirmation() {
      const ranking = await getAdminCaptainRanking(seasonId);
      return {
        seasonId,
        expectedCaptains: ranking.seeds.map(({ id, userId }) => ({ registrationId: id, userId })),
      };
    }
    await expect(confirmCaptains(await currentConfirmation())).resolves.toMatchObject({
      success: false,
      error: { code: "VOTING_MINIMUM_NOT_MET" },
    });
    for (const candidate of players.slice(0, 3)) {
      await pool.query("INSERT INTO captain_votes (voter_registration_id, candidate_registration_id) VALUES ($1, $2)", [voter.registrationId, candidate.registrationId]);
    }

    const preview = await currentConfirmation();
    const voteChange = await pool.connect();
    try {
      await voteChange.query("BEGIN");
      await voteChange.query("SELECT id FROM seasons WHERE id=$1 FOR SHARE", [seasonId]);
      await voteChange.query(
        "UPDATE captain_votes SET candidate_registration_id=$1 WHERE voter_registration_id=$2 AND candidate_registration_id=$3",
        [players[8]!.registrationId, voter.registrationId, players[2]!.registrationId],
      );
      const [{ pid }] = (await voteChange.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
      const confirming = confirmCaptains(preview);
      await expect.poll(async () => {
        const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
        return waiting.rowCount;
      }, { timeout: 2000, interval: 10 }).toBe(1);
      await voteChange.query("COMMIT");
      await expect(confirming).resolves.toMatchObject({
        success: false,
        error: { code: "VALIDATION_FAILED", message: expect.stringContaining("名单或选秀顺位已变化") },
      });
    } finally {
      await voteChange.query("ROLLBACK");
      voteChange.release();
    }
    expect((await pool.query(
      `SELECT status,
        (SELECT count(*)::int FROM competition_entries WHERE competition_id=$1) AS entries,
        (SELECT count(*)::int FROM audit_logs WHERE season_id=$1 AND action='captain.confirm') AS confirmations
       FROM seasons WHERE id=$1`,
      [seasonId],
    )).rows).toEqual([{ status: "voting", entries: 0, confirmations: 0 }]);

    auth.userId = voter.userId;
    await expect(retractVote({
      voterRegistrationId: voter.registrationId,
      candidateRegistrationId: players[8]!.registrationId,
    })).resolves.toMatchObject({ success: true });
    await expect(castVote({
      voterRegistrationId: voter.registrationId,
      candidateRegistrationId: players[2]!.registrationId,
    })).resolves.toMatchObject({ success: true });
    auth.userId = players[0]!.userId;
    const reviewed = await currentConfirmation();
    const [first, second, ...rest] = reviewed.expectedCaptains;
    await expect(confirmCaptains({ seasonId, expectedCaptains: [second, first, ...rest] })).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_FAILED", message: expect.stringContaining("名单或选秀顺位已变化") },
    });

    const formed = await confirmCaptains(reviewed);
    expect(formed.success).toBe(true);
    if (!formed.success) throw new Error(formed.error.message);
    const entries = (await pool.query<{ id: string; representative_user_id: string; source_registration_id: string; formation_order: number }>(
      "SELECT id, representative_user_id, source_registration_id, formation_order FROM competition_entries WHERE competition_id=$1 ORDER BY formation_order", [seasonId],
    )).rows;
    expect(entries.map(row => ({ user: row.representative_user_id, source: row.source_registration_id, order: row.formation_order }))).toEqual(
      players.slice(0, 8).map(player => ({ user: player.userId, source: player.registrationId, order: player.index + 1 })),
    );
    expect((await pool.query(`SELECT count(*)::int AS count FROM competition_entries e
      JOIN competition_entry_participants p ON p.entry_id=e.id AND p.user_id=e.representative_user_id AND p.status='confirmed'
      JOIN competition_entry_roster_members rm ON rm.revision_id=e.current_roster_revision_id AND rm.participant_id=p.id
      JOIN event_rosters r ON r.entry_id=e.id
      JOIN event_roster_members m ON m.event_roster_id=r.id AND m.participant_id=p.id
      JOIN competition_entry_representative_changes c ON c.entry_id=e.id AND c.to_user_id=p.user_id
      WHERE e.competition_id=$1 AND e.source='event_native'`, [seasonId])).rows).toEqual([{ count: 8 }]);
    const match = { seasonId, entryAId: entries[0]!.id, entryBId: entries[1]!.id } as Parameters<typeof getEntryIdForRepresentative>[1];
    await expect(getEntryIdForRepresentative(players[0]!.userId, match)).resolves.toBe(entries[0]!.id);
    await expect(getEntryIdForRepresentative(players[1]!.userId, match)).resolves.toBe(entries[1]!.id);
    await expect(getEntryIdForRepresentative(players[2]!.userId, match)).resolves.toBeNull();
    await expect(getEntryIdForRepresentative(players[0]!.userId, { ...match, seasonId: randomUUID() })).resolves.toBeNull();
    await expect(getEntryIdForRepresentative(players[8]!.userId, match)).resolves.toBeNull();

    await pool.query("INSERT INTO draft_state (season_id, current_entry_id, current_round, round_deadline, is_active) VALUES ($1, $2, 1, now()+interval '10 minutes', true)", [seasonId, entries[0]!.id]);
    const input = { seasonId, entryId: entries[0]!.id, registrationId: players[8]!.registrationId, clientRequestId: randomUUID() };
    auth.userId = players[1]!.userId;
    expect(await pickPlayer(input)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
    expect((await pool.query("SELECT count(*)::int AS count FROM draft_picks WHERE season_id=$1", [seasonId])).rows).toEqual([{ count: 0 }]);
    auth.userId = players[0]!.userId;
    const picked = await pickPlayer(input);
    expect(picked).toMatchObject({ success: true, data: { idempotent: false, completed: false } });
    expect(await pickPlayer(input)).toMatchObject({ success: true, data: { idempotent: true } });
    expect((await pool.query(`SELECT dp.registration_id, p.user_id, m.is_primary_starter FROM draft_picks dp
      JOIN competition_entry_participants p ON p.entry_id=dp.entry_id AND p.user_id=$2 AND p.status='confirmed'
      JOIN competition_entries e ON e.id=dp.entry_id
      JOIN competition_entry_roster_members rm ON rm.revision_id=e.current_roster_revision_id AND rm.participant_id=p.id
      JOIN event_rosters r ON r.entry_id=e.id
      JOIN event_roster_members m ON m.event_roster_id=r.id AND m.participant_id=p.id
      WHERE dp.season_id=$1`, [seasonId, players[8]!.userId])).rows).toEqual([
      { registration_id: players[8]!.registrationId, user_id: players[8]!.userId, is_primary_starter: true },
    ]);
    expect((await pool.query("SELECT action FROM audit_logs WHERE season_id=$1 ORDER BY created_at", [seasonId])).rows).toEqual([
      { action: "captain.confirm" }, { action: "draft.pick" },
    ]);
    const [fullDraft, summary] = await Promise.all([
      getPublicDraftData(seasonId),
      getPublicDraftSummary(seasonId),
    ]);
    expect(summary).toEqual({
      state: fullDraft.state,
      teams: fullDraft.teams.map(({ entryId, teamName }) => ({ entryId, teamName })),
      totalPicks: fullDraft.totalPicks,
      maxPicks: fullDraft.maxPicks,
    });
    expect(summary.totalPicks).toBe(1);
    expect(summary.teams.some((team) => team.entryId === summary.state?.currentEntryId)).toBe(true);
  } finally {
    await pool.end();
  }
});
