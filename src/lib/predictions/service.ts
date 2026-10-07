import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";
import { writeAuditInTx } from "@/lib/audit/write";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  predictionPrograms as programs,
  predictionStageMilestones as milestones,
  predictionContests as contests,
  predictionAccounts as accounts,
  predictionPicks as picks,
  predictionJudgements as judgements,
  predictionMarkets as markets,
  predictionMarketOptions as options,
  predictionStakes as stakes,
  predictionSettlements as settlements,
  predictionLedger as ledger,
  predictionJobs as jobs,
  users,
  matches,
  majorStageRuns,
  majorFinalResults,
  seasonAdminGrants,
  eventRosterMembers,
  eventRosters,
} from "@/db/schema";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { AppError, ErrorCode } from "@/lib/errors";
import { loadBaseline, officialWinner } from "./baseline";
import {
  resolveMarketOptions,
  type MarketResolutionFact,
} from "./market-resolution";
import { simulateMajor } from "./simulator";
import {
  distributePool,
  effectivePredictionMarketDeadline,
  validatePick,
  defaultPredictionRules,
} from "./rules";
import {
  samePick,
  type Baseline,
  type Pick,
} from "./types";
import { officialPickEmStages, pickEmWindowState, samePredictionEntrants } from "./lifecycle";
const zero = BigInt(0);
function invalid(message: string): never {
  throw new AppError(ErrorCode.VALIDATION_FAILED, message);
}
async function databaseTime(tx: TxDb): Promise<Date> {
  const result = await tx.execute<{ now: Date }>(
    sql`select clock_timestamp() as now`,
  );
  return new Date(result.rows[0]!.now);
}
/** Identity -> season lifecycle -> official match -> outbox -> program. Reconciler never locks official rows. */
async function activeUser(tx: TxDb, userId: string) {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("share");
  if (!user || user.status !== "active" || !user.emailVerifiedAt)
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "请先完成账号邮箱验证；归并账号请重新登录",
    );
  return user;
}
export async function lockPredictionProgram(tx: TxDb, seasonId: string) {
  await tx.insert(jobs).values({ seasonId }).onConflictDoNothing();
  await tx.select().from(jobs).where(eq(jobs.seasonId, seasonId)).for("update");
  const [program] = await tx
    .select()
    .from(programs)
    .where(eq(programs.seasonId, seasonId))
    .for("update");
  if (!program) invalid("观赛预测尚未开放");
  return program;
}
async function accountFor(tx: TxDb, seasonId: string, userId: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.seasonId, seasonId), eq(accounts.userId, userId)));
  if (!account) invalid("请先加入本届观赛预测");
  return account;
}
async function writeLedger(tx: TxDb, input: typeof ledger.$inferInsert) {
  await tx
    .insert(ledger)
    .values(input)
    .onConflictDoNothing({ target: [ledger.accountId, ledger.source] });
}
export async function balanceOf(tx: TxDb, accountId: string): Promise<bigint> {
  const [row] = await tx
    .select({ amount: sql<string>`coalesce(sum(${ledger.amount}),0)::text` })
    .from(ledger)
    .where(eq(ledger.accountId, accountId));
  return BigInt(row?.amount ?? "0");
}
/** Window publication is separate from judging/Bet settlement: official transitions never wait for those. */
async function syncPickEmWindowsInTx(tx: TxDb, base: Baseline, now: Date) {
  const seasonId = base.seasonId;
  const eligible = officialPickEmStages(base);
  for (const stage of eligible) {
    const state = pickEmWindowState(base, { stageKey: stage.key, deadline: null, lockedAt: null }, now);
    await tx.insert(contests).values({
      seasonId, stageKey: stage.key, kind: stage.kind, entrants: stage.entrants,
      stageRunId: stage.stageRunId, deadline: state.deadline, lockedAt: state.locked ? now : null,
    }).onConflictDoNothing();
  }
  const allContests = await tx
    .select()
    .from(contests)
    .where(eq(contests.seasonId, seasonId));
  for (const contest of allContests) {
    const current = eligible.find((stage) => stage.key === contest.stageKey);
    const mismatch = !current ||
      (contest.stageRunId !== null && contest.stageRunId !== current.stageRunId) ||
      !samePredictionEntrants(contest.entrants, current.entrants);
    if (mismatch && !contest.voidedAt) {
      await tx
        .update(contests)
        .set({ voidedAt: now, voidReason: "官方阶段名单更正，原预测单作废" })
        .where(eq(contests.id, contest.id));
      contest.voidedAt = now;
    }
    const state = pickEmWindowState(base, contest, now);
    // Do not rewrite PostgreSQL's immutable lock timestamp through JS millisecond precision.
    const binding = !mismatch && !contest.stageRunId && current?.stageRunId
      ? { stageRunId: current.stageRunId } : {};
    if (!contest.lockedAt || binding.stageRunId) {
      await tx.update(contests).set({
        ...(!contest.lockedAt ? { deadline: state.deadline, lockedAt: state.locked ? now : null } : {}),
        ...binding,
      }).where(eq(contests.id, contest.id));
    }
  }
}

/** Must hold outbox and program locks; all facts read without locking tournament owners. */
export async function reconcilePredictionProgram(
  tx: TxDb,
  program: typeof programs.$inferSelect,
  force = false,
): Promise<Baseline> {
  const seasonId = program.seasonId;
  const now = await databaseTime(tx);
  const base = await loadBaseline(tx, seasonId);
  const due = await tx.execute<{ due: boolean }>(
    sql`select public.prediction_reconciliation_is_due(${seasonId}::uuid) as due`,
  );
  if (!force && !due.rows[0]?.due) {
    await tx
      .update(jobs)
      .set({ updatedAt: now })
      .where(eq(jobs.seasonId, seasonId));
    return base;
  }
  const official = await tx
    .select()
    .from(matches)
    .where(eq(matches.seasonId, seasonId));
  const runs = await tx
    .select()
    .from(majorStageRuns)
    .where(eq(majorStageRuns.seasonId, seasonId));
  const [final] = await tx
    .select()
    .from(majorFinalResults)
    .where(eq(majorFinalResults.seasonId, seasonId));
  const allAccounts = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.seasonId, seasonId));
  const launches = await tx
    .select()
    .from(milestones)
    .where(eq(milestones.seasonId, seasonId));
  for (const run of launches) {
    const stage = base.stages.find((s) => s.key === run.stageKey);
    if (!stage?.previousKey || !program.rules.stagePoints) continue;
    for (const account of allAccounts.filter(
      (a) => a.joinedAt < run.openedAt,
    )) {
      await writeLedger(tx, {
        seasonId,
        accountId: account.id,
        amount: BigInt(program.rules.stagePoints),
        kind: "stage",
        source: `stage/${run.stageKey}`,
      });
    }
  }
  await syncPickEmWindowsInTx(tx, base, now);
  const stageResults = simulateMajor(base, {});
  const allContests = await tx.select().from(contests).where(eq(contests.seasonId, seasonId));
  for (const contest of allContests) {
    const run = base.runs.find((r) => r.key === contest.stageKey);
    const stage = stageResults.find((s) => s.key === contest.stageKey);
    const accepted =
      contest.kind === "swiss"
        ? run?.finalizedRound === 5
        : final?.status === "confirmed";
    const actual =
      !contest.voidedAt && accepted && stage?.complete ? stage.pick : null;
    const fingerprint = JSON.stringify({ void: !!contest.voidedAt, actual });
    const [previous] = await tx
      .select()
      .from(judgements)
      .where(eq(judgements.contestId, contest.id))
      .orderBy(desc(judgements.createdAt))
      .limit(1);
    if (previous?.fingerprint !== fingerprint)
      await tx
        .insert(judgements)
        .values({ contestId: contest.id, fingerprint, actual });
    if (
      contest.lockedAt &&
      !contest.voidedAt &&
      program.rules.participationPoints
    ) {
      const submissions = await tx
        .select({ accountId: picks.accountId })
        .from(picks)
        .where(and(eq(picks.contestId, contest.id), eq(picks.submitted, true)));
      for (const accountId of new Set(submissions.map((p) => p.accountId)))
        await writeLedger(tx, {
          seasonId,
          accountId,
          amount: BigInt(program.rules.participationPoints),
          kind: "participation",
          source: `participation/${contest.id}`,
        });
    }
    if (contest.voidedAt) {
      const rewards = await tx
        .select()
        .from(ledger)
        .where(
          and(
            eq(ledger.seasonId, seasonId),
            eq(ledger.source, `participation/${contest.id}`),
          ),
        );
      for (const reward of rewards)
        await writeLedger(tx, {
          seasonId,
          accountId: reward.accountId,
          amount: -reward.amount,
          kind: "reversal",
          source: `void/${reward.id}`,
        });
    }
  }
  const allMarkets = await tx
    .select()
    .from(markets)
    .where(eq(markets.seasonId, seasonId));
  for (const market of allMarkets) {
    const match = official.find((m) => m.id === market.matchId);
    const voided =
      !match ||
      match.majorStageRunId !== market.subject.stageRunId ||
      match.entryAId !== market.subject.entryIds[0] ||
      match.entryBId !== market.subject.entryIds[1] ||
      match.status === "cancelled";
    const winner = match && !voided ? officialWinner(match) : null;
    // A finished score is settled only when the tournament owner accepts its round.
    const run = match ? runs.find((r) => r.id === match.majorStageRunId) : null;
    const accepted = match?.round
      ? !!run && run.finalizedRound >= match.round
      : match?.entryRound === "quarterfinal"
        ? official.some(
            (m) =>
              m.majorStageRunId === match.majorStageRunId &&
              m.entryRound === "semifinal",
          )
        : match?.entryRound === "semifinal"
          ? official.some(
              (m) =>
                m.majorStageRunId === match.majorStageRunId &&
                m.entryRound === "final",
            )
          : final?.status === "confirmed";
    const rows = await tx
      .select()
      .from(stakes)
      .where(eq(stakes.marketId, market.id));
    const marketOptions = await tx
      .select()
      .from(options)
      .where(eq(options.marketId, market.id));
    // Resolver registry is deliberately closed: a new market requires a confirmed-fact adapter.
    if (market.resolver !== "match_winner")
      throw new Error(`Unsupported prediction resolver: ${market.resolver}`);
    const fact: MarketResolutionFact = voided
      ? {
          state: "void",
          revision: JSON.stringify({ matchId: market.matchId, voided: true }),
        }
      : winner && accepted
        ? {
            state: "confirmed",
            winningKeys: [winner],
            revision: JSON.stringify({
              run: run?.id,
              winner,
              scoreA: match?.scoreA,
              scoreB: match?.scoreB,
              accepted,
            }),
          }
        : { state: "pending", revision: "pending" };
    const resolution = resolveMarketOptions(marketOptions, fact);
    const total = rows.reduce((n, row) => n + row.amount, zero);
    const winningPool = rows
      .filter((row) => resolution.winningOptionIds.includes(row.optionId))
      .reduce((n, row) => n + row.amount, zero);
    const state =
      resolution.state === "settled" &&
      (winningPool === zero || winningPool === total)
        ? "refunded"
        : resolution.state;
    const winningOptionIds =
      state === "settled" ? resolution.winningOptionIds : [];
    if (
      !market.lockedAt &&
      (now >= market.deadline || voided || match?.status !== "scheduled")
    )
      await tx
        .update(markets)
        .set({ lockedAt: now })
        .where(eq(markets.id, market.id));
    const fingerprint = JSON.stringify({
      state,
      winningOptionIds,
      factRevision: resolution.factRevision,
    });
    const [previous] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.marketId, market.id))
      .orderBy(desc(settlements.createdAt))
      .limit(1);
    if (previous?.fingerprint === fingerprint) continue;
    const [batch] = await tx
      .insert(settlements)
      .values({
        marketId: market.id,
        fingerprint,
        state,
        winningOptionIds,
        factRevision: resolution.factRevision,
      })
      .returning();
    if (!batch) throw new Error("Settlement insert failed");
    if (previous) {
      const old = await tx
        .select()
        .from(ledger)
        .where(
          and(
            eq(ledger.seasonId, seasonId),
            eq(ledger.source, `settlement/${previous.id}`),
          ),
        );
      for (const row of old)
        await writeLedger(tx, {
          seasonId,
          accountId: row.accountId,
          amount: -row.amount,
          profit: -row.profit,
          kind: "reversal",
          source: `reversal/${batch.id}/${row.id}`,
        });
    }
    if (state !== "pending") {
      const positions = rows.map((s) => ({
        accountId: s.accountId,
        optionId: s.optionId,
        stake: s.amount,
      }));
      const payouts = distributePool(
        positions,
        state === "settled" ? winningOptionIds : null,
      );
      for (const [accountId, amount] of payouts) {
        const invested = rows
          .filter((s) => s.accountId === accountId)
          .reduce((n, s) => n + s.amount, zero);
        await writeLedger(tx, {
          seasonId,
          accountId,
          amount,
          profit: amount - invested,
          kind: "settlement",
          source: `settlement/${batch.id}`,
        });
      }
    }
  }
  await tx
    .update(jobs)
    .set({ dirty: false, updatedAt: now })
    .where(eq(jobs.seasonId, seasonId));
  return base;
}
export async function joinPredictionsInTx(
  tx: TxDb,
  input: { seasonId: string; userId: string },
) {
  await activeUser(tx, input.userId);
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const program = await lockPredictionProgram(tx, input.seasonId);
  await reconcilePredictionProgram(tx, program);
  const [account] = await tx
    .insert(accounts)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (account)
    await writeLedger(tx, {
      seasonId: input.seasonId,
      accountId: account.id,
      amount: BigInt(program.rules.initialPoints),
      kind: "initial",
      source: "initial",
    });
  return { joined: true };
}
export async function savePickInTx(
  tx: TxDb,
  input: {
    seasonId: string;
    userId: string;
    contestId: string;
    pick: Pick;
    submitted: boolean;
    requestId: string;
  },
) {
  await activeUser(tx, input.userId);
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const [target] = await tx
    .select()
    .from(contests)
    .where(
      and(
        eq(contests.id, input.contestId),
        eq(contests.seasonId, input.seasonId),
      ),
    );
  if (!target) invalid("阶段窗口不存在");
  await tx
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.seasonId, input.seasonId),
        eq(matches.stage, target.stageKey),
      ),
    )
    .orderBy(asc(matches.id))
    .for("share");
  const program = await lockPredictionProgram(tx, input.seasonId);
  const base = await reconcilePredictionProgram(tx, program);
  const account = await accountFor(tx, input.seasonId, input.userId);
  const [replay] = await tx
    .select()
    .from(picks)
    .where(
      and(
        eq(picks.accountId, account.id),
        eq(picks.requestId, input.requestId),
      ),
    );
  if (replay) {
    if (
      replay.contestId !== input.contestId ||
      replay.submitted !== input.submitted ||
      !samePick(replay.pick, input.pick)
    )
      invalid("重复请求标识与内容不一致");
    return {
      version: replay.version,
      submitted: replay.submitted,
      at: replay.createdAt.toISOString(),
    };
  }
  const [contest] = await tx
    .select()
    .from(contests)
    .where(eq(contests.id, input.contestId));
  const current = officialPickEmStages(base).find((stage) => stage.key === target.stageKey);
  if (
    !contest ||
    contest.voidedAt ||
    contest.lockedAt ||
    pickEmWindowState(base, contest, await databaseTime(tx)).locked ||
    !current ||
    current.stageRunId !== contest.stageRunId ||
    !samePredictionEntrants(contest.entrants, current.entrants)
  )
    invalid("阶段已截止或官方名单发生变化，原有效提交保持不变");
  if ((contest.kind === "swiss") !== ("perfect" in input.pick))
    invalid("草稿类型与本阶段不一致");
  if (input.submitted) {
    try {
      validatePick(input.pick, contest.entrants, contest.kind, program.rules);
    } catch (e) {
      invalid(e instanceof Error ? e.message : "预测单不合法");
    }
  }
  const [latest] = await tx
    .select({ version: picks.version })
    .from(picks)
    .where(
      and(eq(picks.contestId, contest.id), eq(picks.accountId, account.id)),
    )
    .orderBy(desc(picks.version))
    .limit(1);
  const [saved] = await tx
    .insert(picks)
    .values({
      seasonId: input.seasonId,
      contestId: contest.id,
      accountId: account.id,
      pick: input.pick,
      submitted: input.submitted,
      requestId: input.requestId,
      version: (latest?.version ?? 0) + 1,
    })
    .returning();
  return {
    version: saved!.version,
    submitted: saved!.submitted,
    at: saved!.createdAt.toISOString(),
  };
}
export async function stakeInTx(
  tx: TxDb,
  input: {
    seasonId: string;
    userId: string;
    marketId: string;
    optionId: string;
    amount: string;
    requestId: string;
  },
) {
  const user = await activeUser(tx, input.userId);
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const [target] = await tx
    .select()
    .from(markets)
    .where(
      and(eq(markets.id, input.marketId), eq(markets.seasonId, input.seasonId)),
    );
  if (!target) invalid("积分池不存在");
  const [match] = await tx
    .select()
    .from(matches)
    .where(
      and(eq(matches.id, target.matchId), eq(matches.seasonId, input.seasonId)),
    )
    .for("share");
  const program = await lockPredictionProgram(tx, input.seasonId);
  await reconcilePredictionProgram(tx, program);
  const account = await accountFor(tx, input.seasonId, input.userId);
  const [replay] = await tx
    .select()
    .from(stakes)
    .where(
      and(
        eq(stakes.accountId, account.id),
        eq(stakes.requestId, input.requestId),
      ),
    );
  if (replay) {
    if (
      replay.marketId !== input.marketId ||
      replay.optionId !== input.optionId ||
      (input.amount !== "all" && replay.amount.toString() !== input.amount)
    )
      invalid("重复请求标识与内容不一致");
    return { amount: replay.amount.toString() };
  }
  const [market] = await tx
    .select()
    .from(markets)
    .where(eq(markets.id, target.id));
  const now = await databaseTime(tx);
  const effectiveDeadline = market
    ? effectivePredictionMarketDeadline({
        marketDeadline: market.deadline,
        scheduledAt: match?.scheduledAt ?? null,
        cutoffMinutes: program.rules.cutoffMinutes,
      })
    : null;
  if (
    program.paused ||
    !market ||
    market.lockedAt ||
    !effectiveDeadline ||
    now >= effectiveDeadline ||
    !match ||
    match.status !== "scheduled" ||
    match.majorStageRunId !== market.subject.stageRunId ||
    match.entryAId !== market.subject.entryIds[0] ||
    match.entryBId !== market.subject.entryIds[1]
  )
    invalid("积分池已关闭");
  const [option] = await tx
    .select()
    .from(options)
    .where(
      and(eq(options.id, input.optionId), eq(options.marketId, market.id)),
    );
  if (!option) invalid("所选选项不属于本积分池");
  const admins = await tx
    .select()
    .from(seasonAdminGrants)
    .where(
      and(
        eq(seasonAdminGrants.seasonId, input.seasonId),
        eq(seasonAdminGrants.userId, input.userId),
      ),
    );
  const roster = await tx
    .select({ id: eventRosterMembers.id })
    .from(eventRosterMembers)
    .innerJoin(
      eventRosters,
      eq(eventRosters.id, eventRosterMembers.eventRosterId),
    )
    .where(
      and(
        eq(eventRosterMembers.userId, input.userId),
        inArray(eventRosters.entryId, market.subject.entryIds),
      ),
    );
  if (user.role === "super_admin" || admins.length || roster.length)
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "本场名单成员和赛事管理员不能参与本场积分预测",
    );
  const previous = await tx
    .select()
    .from(stakes)
    .where(
      and(eq(stakes.marketId, market.id), eq(stakes.accountId, account.id)),
    );
  if (previous.some((s) => s.optionId !== input.optionId))
    invalid("已经投入另一方，不能换边");
  const balance = await balanceOf(tx, account.id);
  const amount = input.amount === "all" ? balance : BigInt(input.amount);
  if (amount <= zero || amount > balance)
    invalid("可用积分不足；待追回积分需先抵扣");
  const [saved] = await tx
    .insert(stakes)
    .values({
      seasonId: input.seasonId,
      marketId: market.id,
      accountId: account.id,
      optionId: input.optionId,
      amount,
      requestId: input.requestId,
    })
    .returning();
  await writeLedger(tx, {
    seasonId: input.seasonId,
    accountId: account.id,
    amount: -amount,
    kind: "stake",
    source: `stake/${saved!.id}`,
  });
  return { amount: amount.toString() };
}
export async function openPredictionMarketInTx(
  tx: TxDb,
  input: {
    seasonId: string;
    actorId: string;
    matchId: string;
    deadline: Date;
  },
) {
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const official = await tx
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.seasonId, input.seasonId),
        eq(matches.id, input.matchId),
      ),
    )
    .orderBy(asc(matches.id))
    .for("share");
  const program = await lockPredictionProgram(tx, input.seasonId);
  const base = await reconcilePredictionProgram(tx, program);
  const now = await databaseTime(tx);
  if (
    program.paused ||
    input.deadline <= now ||
    !official.length ||
    official.some(
      (m) => m.status !== "scheduled" || m.ownership !== "major_stage",
    )
  )
    invalid("只允许在官方比赛尚未开始时开放未来截止窗口");
  const scheduled = official
    .filter((m) => m.scheduledAt)
    .map(
      (m) =>
        m.scheduledAt!.getTime() -
        program.rules.cutoffMinutes * 60000,
    );
  const deadline = new Date(Math.min(input.deadline.getTime(), ...scheduled));
  if (deadline <= now) invalid("比赛计划开赛时间已到，不能延后开放");

  const m = official[0]!;
  assertCompetitionMatch(m);
  if (m.entryRound === "third_place") invalid("本届不开放季军赛积分池");
  const [created] = await tx
    .insert(markets)
    .values({
      seasonId: input.seasonId,
      matchId: m.id,
      stageKey: m.stage,
      resolver: "match_winner",
      title: "比赛胜者",
      subject: {
        stageRunId: m.majorStageRunId!,
        entryIds: [m.entryAId, m.entryBId],
      },
      deadline,
    })
    .returning();
  const id = created!.id;
  await tx
    .insert(options)
    .values(
      [m.entryAId, m.entryBId].map((entryId, position) => ({
        marketId: id,
        key: entryId,
        entryId,
        position,
        label:
          base.teams.find((team) => team.teamId === entryId)?.name ?? "队伍",
      })),
    );

  await writeAuditInTx(tx, {
    seasonId: input.seasonId,
    actorId: input.actorId,
    action: "predictions.open_market",
    targetId: id,
    meta: { deadline: deadline.toISOString() },
  });
  return { id };
}
/** Called after official transitions, never from a public read. */
export async function syncAutomaticPickEmInTx(tx: TxDb, seasonId: string) {
  const base = await loadBaseline(tx, seasonId);
  if (!officialPickEmStages(base).length) return;
  await tx.insert(programs).values({ seasonId, rules: defaultPredictionRules(base.stages) }).onConflictDoNothing();
  await lockPredictionProgram(tx, seasonId);
  await syncPickEmWindowsInTx(tx, base, await databaseTime(tx));
}
