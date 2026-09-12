import "server-only";

import { and, eq } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import {
  competitionEntries,
  competitionEntryActiveClaims,
  competitionEntryParticipants,
} from "@/db/schema";
import type { CompetitionEntryParticipantStatus } from "@/lib/competition-entries/presentation";

export type CompetitionEntryParticipantContextExecutor = DB | TxDb;

export interface CompetitionEntryParticipantContext {
  primaryEntry: typeof competitionEntries.$inferSelect | null;
  activeClaimEntryId: string | null;
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
  participantRows: ReadonlyArray<{ entry: T; participantStatus: CompetitionEntryParticipantStatus }>;
  representativeEntries: readonly T[];
  activeClaimEntries: readonly T[];
}): {
  primaryEntry: T | null;
  activeClaimEntryId: string | null;
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
    primaryEntry: activeClaimEntry ?? pendingInvitationRows[0]?.entry ?? fallbackEntries[0] ?? null,
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
export async function loadCompetitionEntryParticipantContext(
  input: { competitionId: string; userId: string },
  executor: CompetitionEntryParticipantContextExecutor = db,
): Promise<CompetitionEntryParticipantContext> {
  const [participantRows, representativeEntries, activeClaimRows] = await Promise.all([
    executor.select({
      entry: competitionEntries,
      participantStatus: competitionEntryParticipants.status,
    })
      .from(competitionEntryParticipants)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionEntryParticipants.entryId))
      .where(and(
        eq(competitionEntryParticipants.userId, input.userId),
        eq(competitionEntries.competitionId, input.competitionId),
      )),
    executor.select()
      .from(competitionEntries)
      .where(and(
        eq(competitionEntries.competitionId, input.competitionId),
        eq(competitionEntries.representativeUserId, input.userId),
      )),
    executor.select({ entry: competitionEntries })
      .from(competitionEntryActiveClaims)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionEntryActiveClaims.entryId))
      .where(and(
        eq(competitionEntryActiveClaims.competitionId, input.competitionId),
        eq(competitionEntryActiveClaims.userId, input.userId),
      )),
  ]);

  return selectCompetitionEntryParticipantContext({
    participantRows,
    representativeEntries,
    activeClaimEntries: activeClaimRows.map((row) => row.entry),
  });
}
