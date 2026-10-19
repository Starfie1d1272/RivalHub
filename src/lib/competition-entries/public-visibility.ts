import { and, eq, inArray, or, sql } from "drizzle-orm";
import { competitionEntries, competitionEntryRosterRevisions, eventRosters } from "@/db/schema";

/** Public entry reads share the approved set. Rivals formation already creates
 * approved event-native entries; team applications must pass review first. */
export function publicCompetitionEntryCondition() {
  return eq(competitionEntries.registrationStatus, "approved");
}

/** Retain an already-public entry identity while a replacement roster is reviewed.
 * Consumers must read its approved revision, never the pending/current draft. */
export function publicCompetitionEntryIdentityCondition() {
  return or(
    publicCompetitionEntryCondition(),
    and(
      inArray(competitionEntries.registrationStatus, ["changes_requested", "submitted"]),
      sql`exists (select 1 from ${competitionEntryRosterRevisions} as public_approved_roster
        where public_approved_roster.id = ${competitionEntries.approvedRosterRevisionId}
          and public_approved_roster.entry_id = ${competitionEntries.id}
          and public_approved_roster.status = 'approved')`,
    ),
  );
}

/** A public season player must belong to an approved entry with a confirmed
 * event roster. Preparing rosters remain an internal pre-event fact. */
export function publicEventRosterPlayerCondition(seasonId: string) {
  return and(
    eq(competitionEntries.competitionId, seasonId),
    publicCompetitionEntryCondition(),
    inArray(eventRosters.status, ["confirmed", "frozen"]),
  );
}

export function publicCompetitionEntryLabel(season: { registrationMode: string; status: string }) {
  return season.registrationMode === "team" && season.status === "registration"
    ? "已通过报名审核的队伍"
    : "赛事队伍";
}
