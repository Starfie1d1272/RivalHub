import type { SeasonCapabilities, StagePlan } from "@/types/season";

export type CompetitionDefinitionIssue = { path: string; message: string };

/** Fail-closed validation shared by custom create, edit and publish flows. */
export function validateCompetitionDefinition(capabilities: Pick<SeasonCapabilities, "stagePlan" | "positions" | "registrationConfig" | "minTeamSize" | "maxTeamSize" | "starterCount">): CompetitionDefinitionIssue[] {
  const issues: CompetitionDefinitionIssue[] = [];
  const stagePlan: StagePlan = capabilities.stagePlan;
  if (stagePlan.length === 0) issues.push({ path: "stagePlan", message: "请至少添加一个比赛阶段。" });
  const stageKeys = new Set<string>();
  for (const stage of stagePlan) {
    if (!stage.key.trim()) issues.push({ path: "stagePlan", message: "每个比赛阶段都需要唯一标识。" });
    if (stageKeys.has(stage.key)) issues.push({ path: "stagePlan", message: "比赛阶段标识不能重复。" });
    stageKeys.add(stage.key);
    if (stage.type === "swiss" || stage.type === "gsl_group") issues.push({ path: "stagePlan", message: "自定义赛事当前支持循环赛、单败淘汰和双败淘汰。" });
    if (stage.teamCount < 2) issues.push({ path: "stagePlan", message: `${stage.name || "比赛阶段"} 至少需要两支队伍。` });
  }
  if (capabilities.positions.length === 0) issues.push({ path: "positions", message: "请至少启用一个位置。" });
  if (new Set(capabilities.positions.map((position) => position.trim())).size !== capabilities.positions.length) {
    issues.push({ path: "positions", message: "位置不能重复。" });
  }
  if (new Set(capabilities.registrationConfig.mapPool).size !== capabilities.registrationConfig.mapPool.length) {
    issues.push({ path: "registrationConfig.mapPool", message: "图池不能包含重复地图。" });
  }
  if (capabilities.minTeamSize > capabilities.maxTeamSize || capabilities.starterCount > capabilities.maxTeamSize) {
    issues.push({ path: "teamSize", message: "队伍人数与首发人数配置不一致。" });
  }
  return issues;
}
