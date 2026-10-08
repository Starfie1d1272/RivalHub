import "server-only";
import { prepareApprovedEventRosterInTx } from "@/lib/event-rosters/prepare-approved";
import { assertPrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { buildRosterEligibilityInTx, freezeQualificationPolicy, type QualificationRosterEligibility } from "@/lib/competition-qualification/eligibility";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type TxDb } from "@/db/client";
import { competitionEntries, matches, matchVetoSessions, seasons, users } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";

export const testMatchInput = z.object({
  seasonId: z.uuid(), entryAId: z.uuid(), entryBId: z.uuid(),
  operatorAId: z.uuid().optional(), operatorBId: z.uuid().optional(),
  format: z.enum(["bo1", "bo3", "bo5"]),
  privilegedSide: z.enum(["a", "b"]),
  scheduledAt: z.iso.datetime().nullable(),
}).strict();

export async function loadTestMatchEntries(seasonId: string, executor: Pick<TxDb, "select"> = db) {
  return executor.select({ id: competitionEntries.id, name: competitionEntries.name }).from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, seasonId), eq(competitionEntries.registrationStatus, "approved")))
    .orderBy(asc(competitionEntries.name));
}

/** Caller authorizes the event. The test marker is immutable and cannot own a tournament node. */
export async function createTestMatchInTx(tx: TxDb, input: z.infer<typeof testMatchInput>, actorId: string) {
  const values = testMatchInput.parse(input);
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, values.seasonId)).for("update");
  if (!season || !["registration", "voting", "drafting", "playing"].includes(season.status)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择未结束的公开赛事。");
  }
  if (values.entryAId === values.entryBId) throw new AppError(ErrorCode.VALIDATION_FAILED, "双方队伍不能相同。");
  const entries = await tx.select().from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), inArray(competitionEntries.id, [values.entryAId, values.entryBId]), eq(competitionEntries.registrationStatus, "approved")))
    .orderBy(asc(competitionEntries.id)).for("update");
  if (entries.length !== 2 || entries.some(entry => !entry.approvedRosterRevisionId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "双方必须是本届已批准名单的队伍。");
  for (const entry of entries) await prepareApprovedEventRosterInTx(tx, {
    seasonId: season.id, entryId: entry.id, actorId,
  });
  const eligibilityByEntry = new Map<string, QualificationRosterEligibility>();
  const coherent = await assertPrestartEntryCoherenceInTx(tx, season.id, entries.map(entry => ({ competitionEntryId: entry.id })));
  for (const row of coherent) {
    if (!["confirmed", "frozen"].includes(row.eventRoster.status)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `「${row.entry.name}」的比赛用名单未能准备完成，请核对当前获批名单。`);
    }
  }
  const policy = season.competitionTemplate === "major" ? await freezeQualificationPolicy(season) : null;
  for (const row of coherent) {
    if (policy) eligibilityByEntry.set(row.entry.id, await buildRosterEligibilityInTx(tx, {
      season, entryId: row.entry.id, rosterRevisionId: row.approvedRevision.id, eventRosterId: row.eventRoster.id, policy,
    }));
  }
  const operatorAId = values.operatorAId ?? entries.find(entry => entry.id === values.entryAId)!.representativeUserId;
  const operatorBId = values.operatorBId ?? entries.find(entry => entry.id === values.entryBId)!.representativeUserId;
  if (operatorAId === operatorBId) throw new AppError(ErrorCode.VALIDATION_FAILED, "请为双方指定不同的 BP 操作人。");
  const operators = await tx.select({ id: users.id }).from(users).where(inArray(users.id, [operatorAId, operatorBId]));
  if (operators.length !== 2) throw new AppError(ErrorCode.VALIDATION_FAILED, "BP 操作账号不存在。");
  const mapPool = normalizeRegistrationConfig(season.registrationConfig).mapPool;
  if (mapPool.length !== 7 || new Set(mapPool).size !== 7) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事需要配置七张不同地图才能创建测试赛。");
  const [match] = await tx.insert(matches).values({
    seasonId: season.id, entryAId: values.entryAId, entryBId: values.entryBId,
    stage: "test", format: values.format, scheduledAt: values.scheduledAt ? new Date(values.scheduledAt) : null,
    testConfig: { mapPool: [...mapPool], operatorAId, operatorBId, ...(policy ? { eligibility: { a: eligibilityByEntry.get(values.entryAId)!, b: eligibilityByEntry.get(values.entryBId)! } } : {}) },
  }).returning();
  await tx.insert(matchVetoSessions).values({ matchId: match.id, privilegedEntryId: values.privilegedSide === "a" ? match.entryAId : match.entryBId });
  await writeAuditInTx(tx, { seasonId: season.id, action: "match.create", actorId, targetId: match.id,
    meta: { purpose: "test", rosterRevisionIds: coherent.map(row => row.approvedRevision.id), entryAId: match.entryAId, entryBId: match.entryBId, operatorAId, operatorBId, format: match.format } });
  return { matchId: match.id, seasonSlug: season.slug };
}

export async function loadTestMatches(input: { seasonId: string } | { viewerId: string }) {
  const a = alias(competitionEntries, "test_entry_a");
  const b = alias(competitionEntries, "test_entry_b");
  return db.select({ id: matches.id, seasonSlug: seasons.slug, teamAName: a.name, teamBName: b.name,
    format: matches.format, status: matches.status, scheduledAt: matches.scheduledAt })
    .from(matches).innerJoin(seasons, eq(seasons.id, matches.seasonId))
    .innerJoin(a, eq(a.id, matches.entryAId)).innerJoin(b, eq(b.id, matches.entryBId))
    .where(and(isNotNull(matches.testConfig), "seasonId" in input ? eq(matches.seasonId, input.seasonId) : or(
      eq(a.representativeUserId, input.viewerId), eq(b.representativeUserId, input.viewerId),
      // JSON IDs are server-written, but comparison is still a bound parameter.
      sql`${matches.testConfig}->>'operatorAId' = ${input.viewerId}`,
      sql`${matches.testConfig}->>'operatorBId' = ${input.viewerId}`,
    )))
    .orderBy(desc(matches.createdAt)).limit(100);
}
