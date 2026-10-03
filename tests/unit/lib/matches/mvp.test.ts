import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import { readMatchMvpResults, settleExpiredMatchMvpVotes } from "@/lib/matches/mvp";

const { writeAudit } = vi.hoisted(() => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: writeAudit }));
vi.mock("@/db/client", () => ({ db: {} }));

const now = new Date("2026-10-02T12:00:00Z");
const due = new Date("2026-10-01T12:00:00Z");

function fixture(matchOverrides: Record<string, unknown> = {}) {
  const match = { id: "match-1", seasonId: "season-1", status: "finished", completedAt: due, winner: null as string | null, ...matchOverrides };
  const candidates = [{ matchId: match.id, seasonSlug: "spring" }];
  const candidateQuery: Record<string, unknown> = {};
  for (const key of ["from", "where", "innerJoin", "orderBy"]) candidateQuery[key] = vi.fn(() => candidateQuery);
  candidateQuery.limit = vi.fn().mockResolvedValue(candidates);
  const lock = vi.fn().mockImplementation(async () => [{ ...match }]);
  const results = [{ playerUserId: "player-1", playerName: "Player", count: 3 }];
  const votesQuery: Record<string, unknown> = {};
  for (const key of ["from", "where", "groupBy"]) votesQuery[key] = vi.fn(() => votesQuery);
  votesQuery.orderBy = vi.fn().mockImplementation(async () => results);
  const persist = vi.fn().mockImplementation(async () => { match.winner = "player-1"; });
  const set = vi.fn(() => ({ where: persist }));
  const tx = {
    select: vi.fn().mockImplementation((fields) => "winner" in fields
      ? { from: () => ({ where: () => ({ for: lock }) }) }
      : votesQuery),
    update: vi.fn(() => ({ set })),
  };
  const database = {
    select: vi.fn(() => candidateQuery),
    transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as DB;
  return { database, lock, persist, set, match, results, tx };
}

describe("scheduled MVP settlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("settles exactly at the cutoff, persists the audit in the same transaction, and is idempotent", async () => {
    const f = fixture();
    expect(await settleExpiredMatchMvpVotes(now, f.database)).toEqual({
      processed: 1, settled: 1, affectedMatches: [{ matchId: "match-1", seasonSlug: "spring" }], failures: [],
    });
    expect(f.lock).toHaveBeenCalledWith("update", { skipLocked: true });
    expect(f.set).toHaveBeenCalledWith({ mvpWinnerUserId: "player-1", updatedAt: now });
    expect(writeAudit).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      action: "match.mvp.settle", actorId: "system", meta: { winnerUserId: "player-1", votes: 3 },
    }));
    expect((await settleExpiredMatchMvpVotes(now, f.database)).settled).toBe(0);
    expect(f.persist).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { completedAt: new Date(due.getTime() + 1) },
    { completedAt: null },
    { status: "cancelled" },
    { winner: "existing-winner" },
  ])("rechecks mutable eligibility under the match lock: %o", async (overrides) => {
    const f = fixture(overrides);
    expect((await settleExpiredMatchMvpVotes(now, f.database)).settled).toBe(0);
    expect(f.persist).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("skips locked matches and records failures for scheduler retry", async () => {
    const f = fixture();
    f.lock.mockResolvedValueOnce([]);
    expect((await settleExpiredMatchMvpVotes(now, f.database)).settled).toBe(0);
    const failure = new Error("database unavailable");
    f.lock.mockRejectedValueOnce(failure);
    expect((await settleExpiredMatchMvpVotes(now, f.database)).failures).toEqual([failure]);
    expect(f.persist).not.toHaveBeenCalled();
  });

  it("aggregates renamed players by identity and makes ties deterministic in SQL", () => {
    const query = readMatchMvpResults("match-1", drizzle.mock({ schema }));
    const sql = query.toSQL().sql;
    expect(sql).toContain('min("player_name")');
    expect(sql).toContain('case when "match_mvp_votes"."player_user_id" is null then "match_mvp_votes"."player_name" end');
    expect(sql).toContain('order by count(*) desc, min("match_mvp_votes"."created_at") asc, "match_mvp_votes"."player_user_id" asc');
  });
});
