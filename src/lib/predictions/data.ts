import { stageTasks, rankPickEmAchievements } from "./achievements";
import { withDisplayScores } from "@/lib/matches/display-score-data";
import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
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
  coinLevel,
  judgePick,
} from "./rules";
import { loadBaselineRead } from "./baseline";

import { loadQualificationRead } from "./qualification-baseline";
import type { SimulationContext } from "./types";
import { simulateMajor } from "./simulator";
import { officialPickEmStages, pickEmWindowState, samePredictionEntrants } from "./lifecycle";

/** Only this projection reaches public RSC/actions; no private roster or account credentials. */
export async function readPredictionSnapshot(
  tx: TxDb,
  seasonId: string,
  userId: string | null,
  view: "sim" | "points" | "record" | "all" = "all",
  detail = true,
) {
  const [program] = await tx
    .select()
    .from(programs)
    .where(eq(programs.seasonId, seasonId));
  const {baseline:base,official}=await loadBaselineRead(tx,seasonId);
  const qualificationRead=detail ? await loadQualificationRead(tx,seasonId,base.name) : {context:null,official:[]};
  const qualification=qualificationRead.context;
  const contexts: SimulationContext[] = [{ kind: "major", baseline: base }];
  if (qualification) contexts.unshift(qualification);
  const visibleIds = !detail ? [] : contexts.flatMap(context => context.baseline.matches.filter(match => match.format === "bo1" && match.status === "finished").map(match => match.id));
  const visible=new Set(visibleIds);
  const scoreFacts=[...official,...qualificationRead.official].filter(match=>visible.has(match.id));
  const displayById = new Map((await withDisplayScores(scoreFacts, tx)).map(match => [match.id, match.displayScore]));
  for (const context of contexts) context.baseline.matches = context.baseline.matches.map(match => ({ ...match, displayScore: displayById.get(match.id) }));
  const defaultContext = qualification && !base.teams.length ? "qualification-short-swiss" as const : "major" as const;
  const records = view === "record" || view === "all";
  const poolsVisible = view === "points" || view === "all";
  const betRecords = view === "all";
  const databaseClock = await tx.execute<{ now: Date }>(
    sql`select clock_timestamp() as now`,
  );
  const now = new Date(databaseClock.rows[0]!.now).getTime();
  const rules = program?.rules ?? defaultPredictionRules(base.stages);
  const allAccounts = records || userId ? await tx
    .select({
      id: accounts.id,
      userId: accounts.userId,
      name: users.displayName,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(eq(accounts.seasonId, seasonId), records ? undefined : eq(accounts.userId, userId!))) : [];
  const me = allAccounts.find((a) => a.userId === userId);
  const windows = await tx
    .select()
    .from(contests)
    .where(eq(contests.seasonId, seasonId));
  const allPicks = records || me ? await tx
    .selectDistinctOn([picks.accountId, picks.contestId, picks.submitted], {
      accountId: picks.accountId, contestId: picks.contestId, submitted: picks.submitted,
      version: picks.version, pick: picks.pick, createdAt: picks.createdAt,
    })
    .from(picks)
    .where(and(eq(picks.seasonId, seasonId), records ? or(eq(picks.submitted, true), me ? eq(picks.accountId, me.id) : undefined) : me ? eq(picks.accountId, me.id) : sql`false`))
    .orderBy(picks.accountId, picks.contestId, picks.submitted, desc(picks.version)) : [];
  const history = (records || !!me) && windows.length
    ? await tx
        .selectDistinctOn([judgements.contestId], { prediction_judgements: { contestId: judgements.contestId, actual: judgements.actual },
          revisionCount: sql<number>`count(*) over (partition by ${judgements.contestId})::int` })
        .from(judgements)
        .innerJoin(contests, eq(contests.id, judgements.contestId))
        .where(eq(contests.seasonId, seasonId))
        .orderBy(judgements.contestId, desc(judgements.createdAt), desc(judgements.id))
    : [];
  const totals = betRecords || (poolsVisible && !!me) ? await tx
    .select({
      accountId: ledger.accountId,
      balance: sql<string>`sum(${ledger.amount})::text`,
      profit: sql<string>`sum(${ledger.profit})::text`,
    })
    .from(ledger)
    .where(and(eq(ledger.seasonId, seasonId), betRecords ? undefined : me ? eq(ledger.accountId, me.id) : sql`false`))
    .groupBy(ledger.accountId) : [];
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
  const myLedger = betRecords && me
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
  return { view, program, base, contexts, defaultContext, records, poolsVisible, betRecords,
    now, rules, allAccounts, me, windows, allPicks, history, totals, pools, allOptions,
    investments, participants, batches, myLedger };
}

/** Only immutable snapshot values are consumed after releasing the RR connection. */
export function projectPredictionBoard(snapshot: Awaited<ReturnType<typeof readPredictionSnapshot>>) {
  const { view, program, base, contexts, defaultContext, records, betRecords, now, rules,
    allAccounts, me, windows, allPicks, history, totals, pools, allOptions, investments,
    participants, batches, myLedger } = snapshot;
  const eligible = officialPickEmStages(base);
  const latestPicks = new Map<string, (typeof allPicks)[number]>();
  const submissions = new Map<string, (typeof allPicks)[number]>();
  for (const pick of allPicks) {
    const key = `${pick.accountId}/${pick.contestId}`;
    if ((latestPicks.get(key)?.version ?? 0) < pick.version) latestPicks.set(key, pick);
    if (pick.submitted && !submissions.has(key)) submissions.set(key, pick);
  }
  const totalsByAccount = new Map(totals.map((total) => [total.accountId, total]));
  const achievements = allAccounts.map((account) => {
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
      const tasks = stageTasks({ type: stage.type, target: rules.swissTarget,
        submitted: !!pick, locked,
        closed: !!contest && pickEmWindowState(base, contest, new Date(now)).locked,
        available: !!contest, voided: !!contest?.voidedAt, result });
      return {
        key: stage.key, name: stage.name, locked, judged: !!result,
        hits: result?.hits ?? null,
        challenges: tasks.slice(1).filter((task) => task.state === "complete").length,
        possible: tasks.filter((task) => ["submitted", "active", "upcoming"].includes(task.state)).length,
        tasks,
      };
    });
    const submissionsCompleted = progress.filter((p) => p.tasks[0]?.state === "complete").length;
    const challenges = submissionsCompleted + progress.reduce((n, p) => n + p.challenges, 0);
    const maximum =
      challenges +
      progress.reduce((n, p) => n + (p.judged ? 0 : p.possible), 0);
    return {
      accountId: account.id,
      name: account.name ?? "观众",
      challenges,
      coin: coinLevel(submissionsCompleted, challenges, rules),
      maximumCoin: coinLevel(submissionsCompleted, maximum, rules),
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
  return {
    view,
    contexts,
    defaultContext,
    base,
    simulation: view === "all" || view === "points" ? simulateMajor(base, {}, true) : null,
    enabled: !!program,
    paused: program?.paused ?? false,
    rules,
    joined: !!me,
    contests: windows.map((c) => {
      const state = pickEmWindowState(base, c, new Date(now));
      const current = eligible.find((stage) => stage.key === c.stageKey);
      const mismatch = !current || (c.stageRunId !== null && c.stageRunId !== current.stageRunId) || !samePredictionEntrants(current.entrants, c.entrants);
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
        deadline: state.deadline?.toISOString() ?? null,
        deadlineTentative: state.deadlineTentative,
        locked: state.locked,
        deadlineReached: !!state.deadline && state.deadline.getTime() <= now,
        voidReason: c.voidReason ?? (mismatch ? "官方阶段名单更正，原预测单作废" : null),
        submitted: submitted
          ? {
              pick: submitted.pick,
              version: submitted.version,
              at: submitted.createdAt.toISOString(),
            }
          : null,
        draft: draft?.pick ?? null,
        judgementRevisions: history.find(h => h.prediction_judgements.contestId === c.id)?.revisionCount ?? 0,
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
      (betRecords ? allAccounts : []).map((a) => ({
        name: a.name ?? "观众",
        value: totalsByAccount.get(a.id)?.profit ?? "0",
        isMe: a.id === me?.id,
      })),
    ),
    pickLeaderboard: records ? rankPickEmAchievements(achievements, me?.id) : [],
  };
}
/** Compatibility reader for internal callers already owning a transaction. */
export async function predictionBoard(tx: TxDb, seasonId: string, userId: string | null,
  view: "sim" | "points" | "record" | "all" = "all") {
  return projectPredictionBoard(await readPredictionSnapshot(tx, seasonId, userId, view));
}

export function projectPickEmSummary(snapshot: Awaited<ReturnType<typeof readPredictionSnapshot>>) {
  const { achievement, pickLeaderboard } = projectPredictionBoard(snapshot);
  return { achievement, pickLeaderboard: pickLeaderboard.slice(0, 100),
    mine: pickLeaderboard.find(row => row.isMe) ?? null };
}
export type PickEmSummary = ReturnType<typeof projectPickEmSummary>;

export type PredictionBoardData = Awaited<ReturnType<typeof predictionBoard>>;

/** Prediction/Pick’Em transport excludes Bet balances, markets and ledgers. */
export function publicPickEmBoard(data: PredictionBoardData) {
  const { view, base, contexts, defaultContext, enabled, joined, contests, achievement, pickLeaderboard } = data;
  const { perfect, advance, eliminated, swissTarget, silver, gold, diamond } = data.rules;
  return { view, base, contexts, defaultContext, enabled, joined, contests, achievement, pickLeaderboard,
    rules: { perfect, advance, eliminated, swissTarget, silver, gold, diamond } };
}
export type PickEmBoardData = ReturnType<typeof publicPickEmBoard>;
