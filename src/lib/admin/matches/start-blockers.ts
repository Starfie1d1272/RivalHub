import type { AdminMatchPreflight, RosterData } from "@/lib/admin/matches/types";

export function matchLineupStatusLabel(status: RosterData["status"] | null): string {
  if (status === "confirmed") return "首发已确认";
  return status === "submitted" ? "首发已提交，待确认" : "尚未提交首发";
}

interface StartBlockerInput {
  requiresPreflight: boolean;
  teamAName: string;
  teamBName: string;
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  teamAPreflight: AdminMatchPreflight | null;
  teamBPreflight: AdminMatchPreflight | null;
}

function getTeamBlockers(
  name: string,
  roster: RosterData | null,
  preflight: AdminMatchPreflight | null,
  requiresPreflight: boolean,
): string[] {
  if (!roster) return [];
  if (roster.starters.length !== 5) return [`${name} 当前不是 5 名首发`];
  if (!requiresPreflight) return [];
  if (!preflight) return [`${name} 尚未完成首发资格检查`];
  if (!preflight.valid) return preflight.blockers.map((blocker) => `${name}：${blocker}`);
  return [];
}

export function getAdminMatchStartBlockers({
  requiresPreflight,
  teamAName,
  teamBName,
  teamARoster,
  teamBRoster,
  teamAPreflight,
  teamBPreflight,
}: StartBlockerInput): string[] {
  return [
    ...getTeamBlockers(teamAName, teamARoster, teamAPreflight, requiresPreflight),
    ...getTeamBlockers(teamBName, teamBRoster, teamBPreflight, requiresPreflight),
  ];
}
