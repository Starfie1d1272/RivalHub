import { eq } from "drizzle-orm";
import { competitionEntries } from "@/db/schema";

/** Public entry reads share the approved set. Rivals formation already creates
 * approved event-native entries; team applications must pass review first. */
export function publicCompetitionEntryCondition() {
  return eq(competitionEntries.registrationStatus, "approved");
}

export function publicCompetitionEntryLabel(season: { registrationMode: string; status: string }) {
  return season.registrationMode === "team" && season.status === "registration"
    ? "已通过报名审核的队伍"
    : "赛事队伍";
}
