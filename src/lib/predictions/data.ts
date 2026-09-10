import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  predictionPrograms as programs,
  predictionContests as contests,
  predictionAccounts as accounts,
  predictionPicks as picks,
  predictionJudgements as judgements,
  predictionMarkets as markets,
  predictionStakes as stakes,
  predictionLedger as ledger,
  predictionSettlements as settlements,
  users,
} from "@/db/schema";
import { generateMajorPlayoffQuarterfinals } from "@/lib/major/playoff";
import { DEFAULT_RULES, coinLevel, judgePick } from "./rules";
import { loadBaseline } from "./baseline";
import { lockPredictionProgram, reconcilePredictionProgram } from "./service";
import { simulateMajor } from "./simulator";

/** Only this projection reaches public RSC/actions; no private roster or account credentials. */
export async function predictionBoard(
  tx: TxDb,
  seasonId: string,
  userId: string | null,
) {
  const [enabled] = await tx
    .select()
    .from(programs)
    .where(eq(programs.seasonId, seasonId));
  const program = enabled ? await lockPredictionProgram(tx, seasonId) : null;
  const base = program
    ? await reconcilePredictionProgram(tx, program)
    : await loadBaseline(tx, seasonId);
  const rules = program?.rules ?? DEFAULT_RULES;
  const allAccounts = await tx
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: users.displayName,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(eq(accounts.seasonId, seasonId));
  const me = allAccounts.find((a) => a.userId === userId);
  const windows = await tx
    .select()
    .from(contests)
    .where(eq(contests.seasonId, seasonId));
  const allPicks = await tx
    .select()
    .from(picks)
    .where(eq(picks.seasonId, seasonId))
    .orderBy(desc(picks.version));
  const history = windows.length
    ? await tx
        .select()
        .from(judgements)
        .innerJoin(contests, eq(contests.id, judgements.contestId))
        .where(eq(contests.seasonId, seasonId))
        .orderBy(desc(judgements.createdAt))
    : [];
  const totals = await tx
    .select({
      accountId: ledger.accountId,
      balance: sql<string>`sum(${ledger.amount})::text`,
      profit: sql<string>`sum(${ledger.profit})::text`,
    })
    .from(ledger)
    .where(eq(ledger.seasonId, seasonId))
    .groupBy(ledger.accountId);
  const achievements = allAccounts.map((account) => {
    const progress = base.stages.map((stage) => {
      const contest = windows.find((c) => c.stageKey === stage.key);
      const pick = contest
        ? allPicks.find(
            (p) =>
              p.contestId === contest.id &&
              p.accountId === account.id &&
              p.submitted,
          )
        : null;
      const actual = contest
        ? history.find((h) => h.prediction_judgements.contestId === contest.id)
            ?.prediction_judgements.actual
        : null;
      const locked = !!(contest?.lockedAt && !contest.voidedAt && pick);
      const result =
        locked && actual && pick ? judgePick(pick.pick, actual) : null;
      const results = result
        ? stage.type === "swiss"
          ? [result.hits >= rules.swissTarget]
          : result.challenges
        : [];
      return {
        key: stage.key,
        name: stage.name,
        locked,
        judged: !!result,
        hits: result?.hits ?? null,
        challenges: results.filter(Boolean).length,
        possible:
          !contest?.voidedAt && (!contest?.lockedAt || !!pick)
            ? (stage.type === "swiss" ? 1 : 3) + (locked ? 0 : 1)
            : 0,
      };
    });
    const locked = progress.filter((p) => p.locked).length;
    const challenges = locked + progress.reduce((n, p) => n + p.challenges, 0);
    const maximum =
      challenges +
      progress.reduce((n, p) => n + (p.judged ? 0 : p.possible), 0);
    return {
      accountId: account.id,
      name: account.name ?? "观众",
      challenges,
      coin: coinLevel(locked, challenges, rules),
      maximumCoin: coinLevel(locked, maximum, rules),
      hits: progress.reduce((n, p) => n + (p.hits ?? 0), 0),
      progress,
    };
  });
  const rank = (rows: { name: string; value: string; isMe: boolean }[]) => {
    const sorted = rows.sort((a, b) =>
      BigInt(a.value) === BigInt(b.value)
        ? a.name.localeCompare(b.name)
        : BigInt(a.value) > BigInt(b.value)
          ? -1
          : 1,
    );
    let previous = "",
      rank = 0;
    return sorted
      .map((row, i) => {
        if (row.value !== previous) {
          rank = i + 1;
          previous = row.value;
        }
        return { ...row, rank };
      })
      .slice(0, 100);
  };
  const pools = await tx
    .select()
    .from(markets)
    .where(eq(markets.seasonId, seasonId));
  const investments = await tx
    .select()
    .from(stakes)
    .where(eq(stakes.seasonId, seasonId));
  const batches = await tx
    .select()
    .from(settlements)
    .innerJoin(markets, eq(markets.id, settlements.marketId))
    .where(eq(markets.seasonId, seasonId))
    .orderBy(desc(settlements.createdAt));
  const myLedger = me
    ? await tx
        .select({
          id: ledger.id,
          amount: ledger.amount,
          profit: ledger.profit,
          kind: ledger.kind,
          createdAt: ledger.createdAt,
        })
        .from(ledger)
        .where(eq(ledger.accountId, me.id))
        .orderBy(desc(ledger.createdAt))
        .limit(100)
    : [];
  return {
    base,
    simulation: simulateMajor(base, {}),
    enabled: !!program,
    paused: program?.paused ?? false,
    rules,
    joined: !!me,
    contests: windows.map((c) => {
      const submitted = me
        ? allPicks.find(
            (p) => p.contestId === c.id && p.accountId === me.id && p.submitted,
          )
        : null;
      const draft = me
        ? allPicks.find((p) => p.contestId === c.id && p.accountId === me.id)
        : null;
      return {
        id: c.id,
        stageKey: c.stageKey,
        kind: c.kind,
        entrants: c.entrants,
        quarterfinals:
          c.kind === "single_elim"
            ? generateMajorPlayoffQuarterfinals(
                c.entrants.map((e) => ({
                  teamId: e.teamId,
                  playoffSeed: e.seed,
                })),
              ).map((p) => [p.higherSeedTeamId, p.lowerSeedTeamId])
            : [],
        deadline: c.deadline.toISOString(),
        locked: !!c.lockedAt,
        voidReason: c.voidReason,
        submitted: submitted
          ? {
              pick: submitted.pick,
              version: submitted.version,
              at: submitted.createdAt.toISOString(),
            }
          : null,
        draft: draft?.pick ?? null,
        judgementRevisions: history.filter(
          (h) => h.prediction_judgements.contestId === c.id,
        ).length,
      };
    }),
    markets: pools.map((m) => {
      const rows = investments.filter((s) => s.marketId === m.id);
      const sum = (side: string) =>
        rows
          .filter((s) => s.side === side)
          .reduce((n, s) => n + s.amount, BigInt(0))
          .toString();
      const mine = rows.filter((s) => s.accountId === me?.id);
      const batch = batches.find(
        (b) => b.prediction_settlements.marketId === m.id,
      )?.prediction_settlements;
      return {
        id: m.id,
        matchId: m.matchId,
        stageKey: m.stageKey,
        a: m.a,
        b: m.b,
        deadline: m.deadline.toISOString(),
        locked: !!m.lockedAt,
        state: batch?.state ?? "pending",
        winner: batch?.winner ?? null,
        aPool: sum(m.a),
        bPool: sum(m.b),
        participants: new Set(rows.map((s) => s.accountId)).size,
        mySide: mine[0]?.side ?? null,
        myStake: mine.reduce((n, s) => n + s.amount, BigInt(0)).toString(),
        revisions: batches.filter(
          (b) => b.prediction_settlements.marketId === m.id,
        ).length,
      };
    }),
    balance: totals.find((t) => t.accountId === me?.id)?.balance ?? "0",
    profit: totals.find((t) => t.accountId === me?.id)?.profit ?? "0",
    ledger: myLedger.map((l) => ({
      ...l,
      amount: l.amount.toString(),
      profit: l.profit.toString(),
      createdAt: l.createdAt.toISOString(),
    })),
    achievement: achievements.find((a) => a.accountId === me?.id) ?? null,
    pointsLeaderboard: rank(
      allAccounts.map((a) => ({
        name: a.name ?? "观众",
        value: totals.find((t) => t.accountId === a.id)?.profit ?? "0",
        isMe: a.id === me?.id,
      })),
    ),
    pickLeaderboard: rank(
      achievements.map((a) => ({
        name: a.name,
        value: String(a.hits),
        isMe: a.accountId === me?.id,
      })),
    ),
  };
}
export type PredictionBoardData = Awaited<ReturnType<typeof predictionBoard>>;
