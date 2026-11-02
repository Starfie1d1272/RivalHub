import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  predictionPrograms as programs,
  predictionStageMilestones as milestones,
  predictionContests as contests,
  predictionAccounts as accounts,
  predictionPicks as picks,
  predictionJudgements as judgements,
  predictionLedger as ledger,
  predictionJobs as jobs,
  users,
  matches,
  majorFinalResults,
} from "@/db/schema";
import { assertSeasonAllowsTournamentMutationInTx } from "@/lib/postevent/guard";
import { AppError, ErrorCode } from "@/lib/errors";
import { loadBaseline } from "./baseline";
import { simulateMajor } from "./simulator";
import {
  validatePick,
  defaultPredictionRules,
} from "./rules";
import {
  samePick,
  type Baseline,
  type Pick,
} from "./types";
import { officialPickEmStages, pickEmWindowState, samePredictionEntrants } from "./lifecycle";
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
async function syncPickEmWindowsInTx(tx: TxDb, base: Baseline, now: Date, eligible=officialPickEmStages(base)) {
  const seasonId = base.seasonId;
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
  const due = force ? undefined : await tx.execute<{ due: boolean }>(
    sql`select public.prediction_reconciliation_is_due(${seasonId}::uuid) as due`,
  );
  if (!force && !due?.rows[0]?.due) {
    await tx
      .update(jobs)
      .set({ updatedAt: now })
      .where(eq(jobs.seasonId, seasonId));
    return base;
  }
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
  const ledgerRows:(typeof ledger.$inferInsert)[]=[];
  for (const run of launches) {
    const stage = base.stages.find((s) => s.key === run.stageKey);
    if (!stage?.previousKey || !program.rules.stagePoints) continue;
    for (const account of allAccounts.filter(
      (a) => a.joinedAt < run.openedAt,
    )) {
      ledgerRows.push({
        seasonId,
        accountId: account.id,
        amount: BigInt(program.rules.stagePoints),
        kind: "stage",
        source: `stage/${run.stageKey}`,
      });
    }
  }
  const stageResults = simulateMajor(base, {});
  await syncPickEmWindowsInTx(tx, base, now,officialPickEmStages(base,stageResults));
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
        ledgerRows.push({
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
        ledgerRows.push({
          seasonId,
          accountId: reward.accountId,
          amount: -reward.amount,
          kind: "reversal",
          source: `void/${reward.id}`,
        });
    }
  }
  for(let start=0;start<ledgerRows.length;start+=1000)await tx.insert(ledger).values(ledgerRows.slice(start,start+1000)).onConflictDoNothing({target:[ledger.accountId,ledger.source]});
  await tx
    .update(jobs)
    .set({ dirty: false, updatedAt: now })
    .where(eq(jobs.seasonId, seasonId));
  return base;
}
/** Caller holds the program lock; first participation and its credit commit with the pick. */
async function ensurePredictionAccountInTx(
  tx: TxDb,
  input: { seasonId: string; userId: string },
  initialPoints: number,
) {
  const [account] = await tx
    .insert(accounts)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (account)
    await writeLedger(tx, {
      seasonId: input.seasonId,
      accountId: account.id,
      amount: BigInt(initialPoints),
      kind: "initial",
      source: "initial",
    });
  return account ?? accountFor(tx, input.seasonId, input.userId);
}
/** Worker due checks do not force a baseline read on an already-consumed job. */
export async function reconcileDuePredictionProgram(tx:TxDb,program:typeof programs.$inferSelect) {
  const due=await tx.execute<{due:boolean}>(sql`select public.prediction_reconciliation_is_due(${program.seasonId}::uuid) as due`);
  if(!due.rows[0]?.due)return false;
  await reconcilePredictionProgram(tx,program,true);
  return true;
}
/** Caller holds lifecycle, relevant official rows, outbox and program locks.
 * Window publication/voiding/deadline latches remain synchronous; judging and
 * monetary corrections stay with the durable worker and never run on admission.
 */
async function ensurePickEmAdmissionSnapshotInTx(tx: TxDb, seasonId: string) {
  const base=await loadBaseline(tx,seasonId);
  const eligible=officialPickEmStages(base);
  await syncPickEmWindowsInTx(tx,base,await databaseTime(tx),eligible);
  // A newly latched deadline must remain due even if no official edit follows.
  await tx.update(jobs).set({dirty:true,updatedAt:sql`clock_timestamp()`}).where(eq(jobs.seasonId,seasonId));
  return {base,eligible};
}
export async function joinPredictionsInTx(
  tx: TxDb,
  input: { seasonId: string; userId: string },
) {
  await activeUser(tx, input.userId);
  await assertSeasonAllowsTournamentMutationInTx(tx, input.seasonId);
  const program = await lockPredictionProgram(tx, input.seasonId);
  await ensurePickEmAdmissionSnapshotInTx(tx, input.seasonId);
  await ensurePredictionAccountInTx(tx, input, program.rules.initialPoints);
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
  const account = await ensurePredictionAccountInTx(tx, { seasonId: input.seasonId, userId: input.userId }, program.rules.initialPoints);
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
  const {base,eligible} = await ensurePickEmAdmissionSnapshotInTx(tx, input.seasonId);
  const [contest] = await tx
    .select()
    .from(contests)
    .where(eq(contests.id, input.contestId));
  const current = eligible.find((stage) => stage.key === target.stageKey);
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
  await tx.update(jobs).set({dirty:true,updatedAt:sql`clock_timestamp()`}).where(eq(jobs.seasonId,input.seasonId));
  return {
    version: saved!.version,
    submitted: saved!.submitted,
    at: saved!.createdAt.toISOString(),
  };
}
/** Called after official transitions, never from a public read. */
export async function syncAutomaticPickEmInTx(tx: TxDb, seasonId: string) {
  const base = await loadBaseline(tx, seasonId);
  const eligible=officialPickEmStages(base);
  if (!eligible.length) return;
  await tx.insert(programs).values({ seasonId, rules: defaultPredictionRules(base.stages) }).onConflictDoNothing();
  await lockPredictionProgram(tx, seasonId);
  await syncPickEmWindowsInTx(tx, base, await databaseTime(tx),eligible);
}
