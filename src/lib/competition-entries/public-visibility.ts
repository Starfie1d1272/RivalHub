import { and, eq, inArray } from "drizzle-orm";
import { competitionEntries, eventRosters } from "@/db/schema";

/** Public entry reads share the approved set. Rivals formation already creates
 * approved event-native entries; team applications must pass review first. */
export function publicCompetitionEntryCondition() {
  return eq(competitionEntries.registrationStatus, "approved");
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
