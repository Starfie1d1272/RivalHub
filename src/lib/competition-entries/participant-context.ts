import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import {
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
  competitionEntryRosterMembers,
} from "@/db/schema";
import type { CompetitionEntryParticipantStatus } from "@/lib/competition-entries/presentation";


export interface CompetitionEntryParticipantContext {
  primaryEntry: typeof competitionEntries.$inferSelect | null;
  activeClaimEntryId: string | null;
  activeClaimEntry: typeof competitionEntries.$inferSelect | null;
  pendingInvitations: Array<{ id: string; name: string }>;
  invitationConflict: null | {
    pendingInvitationCount: number;
    latestPendingInvitationName: string;
  };
}

export interface CompetitionEntrySelectionEntry {
  id: string;
  name: string;
  updatedAt: Date;
}

export function selectCompetitionEntryParticipantContext<T extends CompetitionEntrySelectionEntry>(input: {
  participantRows: ReadonlyArray<{ entry: T; participantStatus: CompetitionEntryParticipantStatus | null }>;
  representativeEntries: readonly T[];
  activeClaimEntries: readonly T[];
  requestedEntryId?: string;
}): {
  primaryEntry: T | null;
  activeClaimEntryId: string | null;
  activeClaimEntry: T | null;
  pendingInvitations: Array<{ id: string; name: string }>;
  invitationConflict: null | {
    pendingInvitationCount: number;
    latestPendingInvitationName: string;
  };
} {
  const activeClaimEntry = input.activeClaimEntries[0] ?? null;
  const relatedEntries = new Map<string, T>();
  for (const row of input.participantRows) relatedEntries.set(row.entry.id, row.entry);
  for (const entry of input.representativeEntries) relatedEntries.set(entry.id, entry);
  if (activeClaimEntry) relatedEntries.set(activeClaimEntry.id, activeClaimEntry);

  const fallbackEntries = [...relatedEntries.values()].sort((left, right) =>
    right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
  );
  const pendingInvitationRows = input.participantRows
    .filter((row) => row.participantStatus === "invited")
    .sort((left, right) => right.entry.updatedAt.getTime() - left.entry.updatedAt.getTime() || left.entry.id.localeCompare(right.entry.id));
  const invitationRows = activeClaimEntry
    ? pendingInvitationRows.filter((row) => row.entry.id !== activeClaimEntry.id)
    : [];

  return {
    primaryEntry: pendingInvitationRows.find(row => row.entry.id === input.requestedEntryId)?.entry ?? activeClaimEntry ?? pendingInvitationRows[0]?.entry ?? fallbackEntries[0] ?? null,
    activeClaimEntry,
    pendingInvitations: pendingInvitationRows.map(row => ({ id: row.entry.id, name: row.entry.name })),
    activeClaimEntryId: activeClaimEntry?.id ?? null,
    invitationConflict: invitationRows.length === 0
      ? null
      : {
        pendingInvitationCount: invitationRows.length,
        latestPendingInvitationName: invitationRows[0]!.entry.name,
      },
  };
}

/**
 * Select the registration-page Entry from the user's active event commitment.
 * Without one, a pending invitation takes precedence over a recently edited past Entry.
 */
type ParticipantContextInput = { competitionId: string; userId: string; requestedEntryId?: string };
type ParticipantContextQueryable = Pick<DB, "select">;

/** An old invitation outside the current revision is history, not a pending task. */
export function currentRosterParticipantStatus() {
  return sql<CompetitionEntryParticipantStatus | null>`case
    when ${competitionEntryParticipants.status} = 'invited' and not exists (
      select 1 from ${competitionEntryRosterMembers}
      where ${competitionEntryRosterMembers.revisionId} = ${competitionEntries.currentRosterRevisionId}
        and ${competitionEntryRosterMembers.participantId} = ${competitionEntryParticipants.id}
    ) then null else ${competitionEntryParticipants.status} end`;
}

function participantContextQueries(executor: ParticipantContextQueryable, input: ParticipantContextInput) {
  return {
    participantRows: () => executor.select({
      entry: competitionEntries,
      participantStatus: currentRosterParticipantStatus(),
    })
      .from(competitionEntryParticipants)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionEntryParticipants.entryId))
      .where(and(
        eq(competitionEntryParticipants.userId, input.userId),
        eq(competitionEntries.competitionId, input.competitionId),
      )),
    representativeEntries: () => executor.select()
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, input.competitionId),
        eq(competitionEntries.representativeUserId, input.userId),
      )),
    activeClaimRows: () => executor.select({ entry: competitionEntries })
      .from(competitionEntryActiveClaims)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionEntryActiveClaims.entryId))
      .where(and(
        eq(competitionEntryActiveClaims.competitionId, input.competitionId),
        eq(competitionEntryActiveClaims.userId, input.userId),
      )),
  } as const;
}

function presentParticipantContext(
  participantRows: Awaited<ReturnType<ReturnType<typeof participantContextQueries>["participantRows"]>>,
  representativeEntries: Awaited<ReturnType<ReturnType<typeof participantContextQueries>["representativeEntries"]>>,
  activeClaimRows: Awaited<ReturnType<ReturnType<typeof participantContextQueries>["activeClaimRows"]>>,
  requestedEntryId?: string,
): CompetitionEntryParticipantContext {
  return selectCompetitionEntryParticipantContext({
    participantRows,
    representativeEntries,
    activeClaimEntries: activeClaimRows.map((row) => row.entry),
    requestedEntryId,
  });
}

/** Pool-level read model: independent queries may use separate pooled connections. */
export async function loadCompetitionEntryParticipantContext(
  input: ParticipantContextInput,
): Promise<CompetitionEntryParticipantContext> {
  const queries = participantContextQueries(db, input);
  const [participantRows, representativeEntries, activeClaimRows] = await Promise.all([
    queries.participantRows(),
    queries.representativeEntries(),
    queries.activeClaimRows(),
  ]);
  return presentParticipantContext(participantRows, representativeEntries, activeClaimRows, input.requestedEntryId);
}

/** Transaction-scoped variant: one TxDb shares one pg.Client, so queries are serialized. */
export async function loadCompetitionEntryParticipantContextInTx(
  tx: TxDb,
  input: ParticipantContextInput,
): Promise<CompetitionEntryParticipantContext> {
  const queries = participantContextQueries(tx, input);
  const participantRows = await queries.participantRows();
  const representativeEntries = await queries.representativeEntries();
  const activeClaimRows = await queries.activeClaimRows();
  return presentParticipantContext(participantRows, representativeEntries, activeClaimRows, input.requestedEntryId);
}
