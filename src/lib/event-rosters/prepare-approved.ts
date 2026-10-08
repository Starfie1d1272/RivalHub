import "server-only";
import { and, eq, or } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, eventRosters, matches, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { assertSinglePrestartEntryCoherenceInTx } from "./coherence";
import { syncApprovedRosterToEventRosterInTx } from "./owner";

/** Prepare an approved execution roster without selecting qualification or Main Event entrants. */
export async function prepareApprovedEventRosterInTx(tx: TxDb, input: {
  seasonId: string; entryId: string; actorId: string;
}) {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season || !["registration", "voting", "drafting", "playing"].includes(season.status)) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只能为未结束的赛事准备名单。");
  }
  const [entry] = await tx.select().from(competitionEntries).where(and(
    eq(competitionEntries.id, input.entryId), eq(competitionEntries.competitionId, season.id),
  )).for("update");
  if (!entry || entry.registrationStatus !== "approved" || !entry.approvedRosterRevisionId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请选择本届已批准名单的队伍。");
  }
  const [existing] = await tx.select().from(eventRosters).where(eq(eventRosters.entryId, entry.id)).for("update");
  if (existing?.sourceRosterRevisionId === entry.approvedRosterRevisionId && ["confirmed", "frozen"].includes(existing.status)) {
    await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id });
    return { seasonSlug: season.slug };
  }
  const [active] = await tx.select({ id: matches.id }).from(matches).where(and(
    eq(matches.seasonId, season.id), eq(matches.status, "in_progress"),
    or(eq(matches.entryAId, entry.id), eq(matches.entryBId, entry.id)),
  )).limit(1);
  if (active) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "该队伍有进行中的比赛，暂时不能更新比赛用名单。");
  await tx.insert(eventRosters).values({ entryId: entry.id, sourceRosterRevisionId: entry.approvedRosterRevisionId })
    .onConflictDoNothing({ target: eventRosters.entryId });
  const coherent = await assertSinglePrestartEntryCoherenceInTx(tx, season.id,
    { competitionEntryId: entry.id }, { requireEventRosterSync: false });
  const result = await syncApprovedRosterToEventRosterInTx(tx, { season, coherent, actorId: input.actorId });
  if (result.changed) await writeAuditInTx(tx, {
    seasonId: season.id, action: "competition_entry.sync_event_roster", actorId: input.actorId, targetId: entry.id,
    meta: { eventRosterId: result.eventRosterId, rosterSize: result.rosterSize, sourceRosterRevisionId: entry.approvedRosterRevisionId },
  });
  return { seasonSlug: season.slug };
}
