import type { AdminMatchPreflight, RosterData } from "@/lib/admin/matches/types";

interface StartBlockerInput {
  requiresPreflight: boolean;
  teamAName: string;
  teamBName: string;
  teamARoster: RosterData | null;
  teamBRoster: RosterData | null;
  teamAPolicy: { starterCount: number } | null;
  teamBPolicy: { starterCount: number } | null;
  teamAPreflight: AdminMatchPreflight | null;
  teamBPreflight: AdminMatchPreflight | null;
}

function getTeamBlockers(
  name: string,
  roster: RosterData | null,
  preflight: AdminMatchPreflight | null,
  requiresPreflight: boolean,
  policy: { starterCount: number } | null,
): string[] {
  if (!roster) return [];
  if (!policy) return [`${name} 的首发规则不可用`];
  if (roster.starters.length !== policy.starterCount) return [`${name} 当前不是 ${policy.starterCount} 名首发`];
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
  teamAPolicy,
  teamBPolicy,
  teamAPreflight,
  teamBPreflight,
}: StartBlockerInput): string[] {
  return [
    ...getTeamBlockers(teamAName, teamARoster, teamAPreflight, requiresPreflight, teamAPolicy),
    ...getTeamBlockers(teamBName, teamBRoster, teamBPreflight, requiresPreflight, teamBPolicy),
  ];
}
