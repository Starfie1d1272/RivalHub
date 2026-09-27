import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  predictionPrograms as programs,
  predictionContests as contests,
  predictionAccounts as accounts,
  predictionPicks as picks,
  predictionJudgements as judgements,
  predictionMarkets as markets,
  predictionMarketOptions as options,
  predictionStakes as stakes,
  predictionLedger as ledger,
  predictionSettlements as settlements,
  users,
} from "@/db/schema";
import { generateMajorPlayoffQuarterfinals } from "@/lib/major/playoff";
import {
  defaultPredictionRules,
  effectivePredictionMarketDeadline,
  stageChallengeCount,
  coinLevel,
  judgePick,
} from "./rules";
import { loadBaseline } from "./baseline";

import { simulateMajor } from "./simulator";

/** Only this projection reaches public RSC/actions; no private roster or account credentials. */
export async function predictionBoard(
  tx: TxDb,
  seasonId: string,
  userId: string | null,
  view: "sim" | "points" | "record" | "all" = "all",
) {
  const [program] = await tx
    .select()
    .from(programs)
    .where(eq(programs.seasonId, seasonId));
  const base = await loadBaseline(tx, seasonId);
  const records = view === "record" || view === "all";
  const poolsVisible = view === "points" || view === "all";
  const [databaseClock] = await tx.select({
    now: sql<Date>`clock_timestamp()`,
  });
  if (!databaseClock) throw new Error("Database clock unavailable");
  const now = databaseClock.now.getTime();
  const rules = program?.rules ?? defaultPredictionRules(base.stages);
  const allAccounts = await tx
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: users.displayName,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(eq(accounts.seasonId, seasonId), records ? undefined : userId ? eq(accounts.userId, userId) : sql`false`));
  const me = allAccounts.find((a) => a.userId === userId);
  const windows = await tx
    .select()
    .from(contests)
    .where(eq(contests.seasonId, seasonId));
  const allPicks = await tx
    .selectDistinctOn([picks.accountId, picks.contestId, picks.submitted])
    .from(picks)
    .where(and(eq(picks.seasonId, seasonId), records ? undefined : me ? eq(picks.accountId, me.id) : sql`false`))
    .orderBy(picks.accountId, picks.contestId, picks.submitted, desc(picks.version));
  const history = records && windows.length
    ? await tx
        .select()
        .from(judgements)
        .innerJoin(contests, eq(contests.id, judgements.contestId))
        .where(eq(contests.seasonId, seasonId))
        .orderBy(desc(judgements.createdAt))
    : [];
  const totals = records || (poolsVisible && !!me) ? await tx
    .select({
      accountId: ledger.accountId,
      balance: sql<string>`sum(${ledger.amount})::text`,
      profit: sql<string>`sum(${ledger.profit})::text`,
    })
    .from(ledger)
    .where(and(eq(ledger.seasonId, seasonId), records ? undefined : me ? eq(ledger.accountId, me.id) : sql`false`))
    .groupBy(ledger.accountId) : [];
  const latestPicks = new Map<string, (typeof allPicks)[number]>();
  const submissions = new Map<string, (typeof allPicks)[number]>();
  for (const pick of allPicks) {
    const key = `${pick.accountId}/${pick.contestId}`;
    if ((latestPicks.get(key)?.version ?? 0) < pick.version) latestPicks.set(key, pick);
    if (pick.submitted && !submissions.has(key)) submissions.set(key, pick);
  }
  const totalsByAccount = new Map(totals.map((total) => [total.accountId, total]));
  const achievements = (records ? allAccounts : []).map((account) => {
    const progress = base.stages.map((stage) => {
      const contest = windows.find((c) => c.stageKey === stage.key);
      const pick = contest ? submissions.get(`${account.id}/${contest.id}`) : null;
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
          !contest?.voidedAt && (!contest || contest.deadline.getTime() > now || !!pick) && (!contest?.lockedAt || !!pick)
            ? stageChallengeCount(stage.type) + (locked ? 0 : 1)
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
  const pools = poolsVisible ? await tx
    .select()
    .from(markets)
    .where(eq(markets.seasonId, seasonId)) : [];
  const allOptions = poolsVisible ? await tx
    .select()
    .from(options)
    .innerJoin(markets, eq(options.marketId, markets.id))
    .where(eq(markets.seasonId, seasonId)) : [];
  // Only aggregate pool totals leave PostgreSQL; never materialize other viewers' stakes.
  const investments = poolsVisible ? await tx
    .select({ marketId: stakes.marketId, optionId: stakes.optionId,
      total: sql<string>`sum(${stakes.amount})::text`,
      mine: sql<string>`coalesce(sum(${stakes.amount}) filter (where ${stakes.accountId} = ${me?.id ?? null}), 0)::text`,
    })
    .from(stakes).where(eq(stakes.seasonId, seasonId))
    .groupBy(stakes.marketId, stakes.optionId) : [];
  const participants = poolsVisible ? await tx
    .select({ marketId: stakes.marketId, count: sql<number>`count(distinct ${stakes.accountId})::int` })
    .from(stakes).where(eq(stakes.seasonId, seasonId)).groupBy(stakes.marketId) : [];
  const batches = poolsVisible ? await tx
    .select()
    .from(settlements)
    .innerJoin(markets, eq(markets.id, settlements.marketId))
    .where(eq(markets.seasonId, seasonId))
    .orderBy(desc(settlements.createdAt)) : [];
  const myLedger = records && me
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
    view,
    base,
    simulation: simulateMajor(base, {}, true),
    enabled: !!program,
    paused: program?.paused ?? false,
    rules,
    joined: !!me,
    contests: windows.map((c) => {
      const submitted = me ? submissions.get(`${me.id}/${c.id}`) : null;
      const draft = me ? latestPicks.get(`${me.id}/${c.id}`) : null;
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
        locked: !!c.lockedAt || c.deadline.getTime() <= now,
        deadlineReached: c.deadline.getTime() <= now,
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
      const match = base.matches.find((candidate) => candidate.id === m.matchId);
      const effectiveDeadline = effectivePredictionMarketDeadline({
        marketDeadline: m.deadline,
        scheduledAt: match?.scheduledAt ? new Date(match.scheduledAt) : null,
        cutoffMinutes: rules.cutoffMinutes,
      });
      const sum = (optionId: string) => rows.find((s) => s.optionId === optionId)?.total ?? "0";
      const mine = rows.filter((s) => BigInt(s.mine) > BigInt(0));
      const batch = batches.find(
        (b) => b.prediction_settlements.marketId === m.id,
      )?.prediction_settlements;
      return {
        id: m.id,
        matchId: m.matchId,
        stageKey: m.stageKey,
        title: m.title,
        options: allOptions
          .filter((row) => row.prediction_market_options.marketId === m.id)
          .map((row) => row.prediction_market_options)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({
            id: o.id,
            label: o.label,
            entryId: o.entryId,
            pool: sum(o.id),
          })),
        deadline: effectiveDeadline.toISOString(),
        locked: !!m.lockedAt || effectiveDeadline.getTime() <= now,
        state: batch?.state ?? "pending",
        winningOptionIds: batch?.winningOptionIds ?? [],
        participants: participants.find((p) => p.marketId === m.id)?.count ?? 0,
        myOptionId: mine[0]?.optionId ?? null,
        myStake: mine.reduce((n, s) => n + BigInt(s.mine), BigInt(0)).toString(),
        revisions: batches.filter(
          (b) => b.prediction_settlements.marketId === m.id,
        ).length,
      };
    }),
    balance: totalsByAccount.get(me?.id ?? "")?.balance ?? "0",
    profit: totalsByAccount.get(me?.id ?? "")?.profit ?? "0",
    ledger: myLedger.map((l) => ({
      ...l,
      amount: l.amount.toString(),
      profit: l.profit.toString(),
      createdAt: l.createdAt.toISOString(),
    })),
    achievement: achievements.find((a) => a.accountId === me?.id) ?? null,
    pointsLeaderboard: rank(
      (records ? allAccounts : []).map((a) => ({
        name: a.name ?? "观众",
        value: totalsByAccount.get(a.id)?.profit ?? "0",
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
