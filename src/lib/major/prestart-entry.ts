import { asc, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitionEntryRosterRevisions, eventRosters } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * Canonical prestart ↔ CompetitionEntry coherence guard.
 *
 * An approved registration fact is not an event frozen-roster fact: when an
 * approved Entry re-enters roster remediation (changes_requested), the prestart
 * event roster must not silently keep consuming the previously approved
 * revision through roster confirmation, the global entrant lock, or Major
 * start. Every irreversible prestart boundary validates through this single
 * guard instead of hand-copying the checks.
 *
 * Error semantics:
 * - Entry no longer approved / stale event-roster sync → expected business
 *   error (`VALIDATION_FAILED`) with an actionable message.
 * - Broken internal references (missing revision, mismatched binding) →
 *   `INTERNAL_ERROR` invariant failure. Both fail closed inside the caller's
 *   transaction; there is no fallback to the old revision.
 */

export interface PrestartCoherenceEntrantRef {
  competitionEntryId: string;
  eventRosterId: string | null;
}

export interface PrestartEntryCoherence {
  entry: typeof competitionEntries.$inferSelect;
  approvedRevision: typeof competitionEntryRosterRevisions.$inferSelect;
  eventRoster: typeof eventRosters.$inferSelect;
}

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "审核中",
  changes_requested: "名单补正中",
  waitlisted: "候补",
  approved: "已批准",
  rejected: "已拒绝",
  withdrawn: "已退出",
};

function invariant(message: string): AppError {
  return new AppError(ErrorCode.INTERNAL_ERROR, `赛前参赛条目数据不一致：${message}`);
}

/**
 * Validate, inside the caller's transaction, that every prestart entrant still
 * refers to its competition Entry's currently approved roster revision and a
 * synced event roster. Entries are locked `FOR UPDATE` so a concurrent roster
 * change cannot slip in between this check and the caller's freeze.
 *
 * `requireEventRosterSync: false` is reserved for the explicit re-sync action
 * (`saveMajorPrestartRoster`): it still validates Entry approval and revision
 * integrity — and still locks the event roster — but skips the
 * sourceRosterRevisionId equality it is about to re-establish itself.
 */
export async function assertPrestartEntryCoherenceInTx(
  tx: TxDb,
  seasonId: string,
  entrants: readonly PrestartCoherenceEntrantRef[],
  options: { requireEventRosterSync?: boolean } = {},
): Promise<PrestartEntryCoherence[]> {
  if (entrants.length === 0) return [];
  const entryIds = [...new Set(entrants.map((entrant) => entrant.competitionEntryId))].sort();
  const entryRows = await tx.select().from(competitionEntries)
    .where(inArray(competitionEntries.id, entryIds)).orderBy(asc(competitionEntries.id)).for("update");
  const entryById = new Map(entryRows.map((entry) => [entry.id, entry]));

  const results: Array<{ entrant: PrestartCoherenceEntrantRef; entry: typeof competitionEntries.$inferSelect }> = [];
  for (const entrant of entrants) {
    const entry = entryById.get(entrant.competitionEntryId);
    if (!entry) throw invariant(`参赛条目 ${entrant.competitionEntryId} 不存在。`);
    if (entry.competitionId !== seasonId) {
      throw invariant(`参赛条目 ${entry.name} 不属于当前赛事。`);
    }
    if (entry.registrationStatus !== "approved") {
      const label = REGISTRATION_STATUS_LABELS[entry.registrationStatus] ?? entry.registrationStatus;
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `参赛条目「${entry.name}」已重新进入${label}状态，不能再继续赛前确认、锁定或开赛；请先完成名单补正并重新审核批准。`,
      );
    }
    if (entry.approvedRosterRevisionId === null) {
      throw invariant(`参赛条目 ${entry.name} 缺少已批准报名名单版本。`);
    }
    results.push({ entrant, entry });
  }

  const revisionRows = await tx.select().from(competitionEntryRosterRevisions)
    .where(inArray(competitionEntryRosterRevisions.entryId, entryIds));
  const revisionById = new Map(revisionRows.map((revision) => [revision.id, revision]));

  const rosterIds = [...new Set(entrants
    .flatMap((entrant) => (entrant.eventRosterId ? [entrant.eventRosterId] : [])))].sort();
  const rosterRows = rosterIds.length === 0
    ? []
    : await tx.select().from(eventRosters).where(inArray(eventRosters.id, rosterIds)).orderBy(asc(eventRosters.id)).for("update");
  const rosterById = new Map(rosterRows.map((roster) => [roster.id, roster]));

  const coherent: PrestartEntryCoherence[] = [];
  for (const { entrant, entry } of results) {
    const approvedRevision = revisionById.get(entry.approvedRosterRevisionId!);
    if (!approvedRevision || approvedRevision.entryId !== entry.id || approvedRevision.id !== entry.approvedRosterRevisionId) {
      throw invariant(`参赛条目 ${entry.name} 的 approved roster revision 指向不存在的报名名单版本。`);
    }
    if (approvedRevision.status !== "approved") {
      throw invariant(`参赛条目 ${entry.name} 的已批准报名名单版本状态不再是 approved。`);
    }
    if (!entrant.eventRosterId) {
      throw invariant(`参赛条目 ${entry.name} 的正式参赛队缺少 event roster。`);
    }
    const eventRoster = rosterById.get(entrant.eventRosterId);
    if (!eventRoster) {
      throw invariant(`参赛条目 ${entry.name} 的赛事名单不存在。`);
    }
    if (eventRoster.entryId !== entry.id) {
      throw invariant(`参赛条目 ${entry.name} 的赛事名单绑定不一致。`);
    }
    if (options.requireEventRosterSync !== false && eventRoster.sourceRosterRevisionId !== approvedRevision.id) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `参赛条目「${entry.name}」的赛事名单仍指向旧的已批准报名名单版本；请重新同步最终名单后再继续。`,
      );
    }
    coherent.push({ entry, approvedRevision, eventRoster });
  }
  return coherent;
}

/** Single-entrant convenience wrapper used by per-entrant prestart actions. */
export async function assertSinglePrestartEntryCoherenceInTx(
  tx: TxDb,
  seasonId: string,
  entrant: PrestartCoherenceEntrantRef,
  options: { requireEventRosterSync?: boolean } = {},
): Promise<PrestartEntryCoherence> {
  const [coherent] = await assertPrestartEntryCoherenceInTx(tx, seasonId, [entrant], options);
  if (!coherent) throw invariant("正式参赛队缺少参赛条目引用。");
  return coherent;
}
