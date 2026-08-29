import { isStageExecutorSupported } from "@/lib/formats";
import type { SeasonCapabilities, StagePlan } from "@/types/season";

export type CompetitionDefinitionIssue = { path: string; message: string };

/**
 * Structural validation for custom competition definitions.
 *
 * Draft create/edit only persists the configuration; the hard gate runs in
 * publishSeason via validateCompetitionDefinition, so a runnable definition is
 * required before the season accepts participants. Stage support is decided by
 * the active executor registry, not by a hardcoded stage-type list.
 */
export function validateCompetitionDefinition(capabilities: Pick<SeasonCapabilities, "stagePlan" | "positions" | "registrationConfig" | "minTeamSize" | "maxTeamSize" | "starterCount">): CompetitionDefinitionIssue[] {
  const issues: CompetitionDefinitionIssue[] = [];
  const stagePlan: StagePlan = capabilities.stagePlan;
  if (stagePlan.length === 0) issues.push({ path: "stagePlan", message: "请至少添加一个比赛阶段。" });
  const stageKeys = new Set<string>();
  for (const stage of stagePlan) {
    if (!stage.key.trim()) issues.push({ path: "stagePlan", message: "每个比赛阶段都需要唯一标识。" });
    if (stageKeys.has(stage.key)) issues.push({ path: "stagePlan", message: "比赛阶段标识不能重复。" });
    stageKeys.add(stage.key);
    if (!isStageExecutorSupported(stage.type)) issues.push({ path: "stagePlan", message: "自定义赛事当前支持循环赛、单败淘汰和双败淘汰。" });
    if (stage.teamCount < 2) issues.push({ path: "stagePlan", message: `${stage.name || "比赛阶段"} 至少需要两支队伍。` });
    if (!stage.matchFormat) issues.push({ path: "stagePlan", message: `${stage.name || "比赛阶段"} 需要设置比赛赛制。` });
    if (stage.advanceTiers.some((tier) => tier.count > stage.teamCount)) issues.push({ path: "stagePlan", message: `${stage.name || "比赛阶段"} 的晋级人数不能超过参赛队伍数。` });
    if (stage.type === "round_robin") {
      if (stage.groupCount !== undefined && stage.groupCount !== 1) issues.push({ path: "stagePlan", message: `${stage.name || "循环赛阶段"} 当前只支持单组运行。` });
      if (stage.matchFormat !== "bo1") issues.push({ path: "stagePlan", message: `${stage.name || "循环赛阶段"} 当前只支持 BO1。` });
    }
    if (stage.type === "double_elim" && stage.matchFormat !== "bo3") issues.push({ path: "stagePlan", message: `${stage.name || "双败淘汰阶段"} 当前只支持 BO3 主赛；总决赛可单独覆写。` });
    if ((stage.type === "single_elim" || stage.type === "double_elim") && (stage.teamCount & (stage.teamCount - 1)) !== 0) issues.push({ path: "stagePlan", message: `${stage.name || "淘汰赛阶段"} 的队伍数必须是 2 的幂。` });
  }
  for (let index = 1; index < stagePlan.length; index++) {
    const previous = stagePlan[index - 1]!;
    const current = stagePlan[index]!;
    // AdvanceTier.count is per group: grouped stages qualify tier.count × groupCount teams in total.
    const qualified = previous.advanceTiers.reduce((sum, tier) => sum + tier.count * (previous.groupCount ?? 1), 0);
    const directEntries = current.entrySeeds ?? 0;
    if (qualified === 0 || qualified + directEntries !== current.teamCount) {
      issues.push({ path: "stagePlan", message: `${previous.name || "上一阶段"} 的晋级人数与 ${current.name || "下一阶段"} 的参赛人数不一致。` });
    }
  }
  const firstStage = stagePlan[0];
  if (firstStage?.seeds && firstStage.seeds.length !== firstStage.teamCount) {
    issues.push({ path: "stagePlan", message: `${firstStage.name || "首阶段"} 的种子数量必须等于参赛队伍数。` });
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
