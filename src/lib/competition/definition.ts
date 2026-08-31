import { isStageExecutorSupported } from "@/lib/formats";
import {
  MAJOR_DEFAULT_CAPABILITIES,
  normalizeAffiliationRules,
  type SeasonCapabilities,
  type StageConfig,
  type StagePlan,
} from "@/types/season";

export type CompetitionDefinitionIssue = { path: string; message: string };

export interface StandardMajorRuleCheck {
  key:
    | "registration-mode"
    | "captain-voting"
    | "draft"
    | "team-size"
    | "stage-count"
    | "stage-order"
    | "swiss-match-format"
    | "entry-cohorts"
    | "stage1-seeds"
    | "affiliation-rule"
    | "stage1"
    | "stage2"
    | "stage3"
    | "playoff";
  passed: boolean;
  reason: string;
}

export interface StandardMajorCheckResult {
  isStandardMajor: boolean;
  checks: StandardMajorRuleCheck[];
  failures: StandardMajorRuleCheck[];
}

function advancesEight(stage: StageConfig | undefined): boolean {
  return stage?.advanceTiers.length === 1 &&
    stage.advanceTiers[0]?.placement === "*" &&
    stage.advanceTiers[0]?.count === 8;
}

function directEntrantCount(stage: StageConfig | undefined, isFirstStage = false): number | undefined {
  if (!stage) return undefined;
  return stage.entrySeeds ?? (isFirstStage ? stage.teamCount : 0);
}

function hasStandardStageOneSeeds(seeds: readonly number[] | undefined): boolean {
  return seeds?.length === 16 &&
    new Set(seeds).size === 16 &&
    seeds.every((seed) => seed >= 17 && seed <= 32);
}

function hasFrozenMajorSwissMatchFormats(
  stage1: StageConfig | undefined,
  stage2: StageConfig | undefined,
  stage3: StageConfig | undefined,
): boolean {
  return stage1?.matchFormat === "bo1" &&
    stage2?.matchFormat === "bo1" &&
    stage3?.matchFormat === "bo3";
}

/** Pure definition validation for the managed standard Major runtime. */
export function checkStandardMajorCapabilities(
  capabilities: SeasonCapabilities,
): StandardMajorCheckResult {
  const [stage1, stage2, stage3, playoff] = capabilities.stagePlan;
  const checks: StandardMajorRuleCheck[] = [
    {
      key: "registration-mode",
      passed: capabilities.registrationMode === "team",
      reason: "标准 Major 使用队伍整体报名。",
    },
    {
      key: "captain-voting",
      passed: capabilities.hasCaptainVoting === false,
      reason: "标准 Major 不启用队长投票。",
    },
    {
      key: "draft",
      passed: capabilities.hasDraft === false,
      reason: "标准 Major 不启用蛇形选秀。",
    },
    {
      key: "team-size",
      passed: capabilities.minTeamSize === 5 && capabilities.maxTeamSize === 9 && capabilities.starterCount === 5,
      reason: "标准 Major 固定正式名单 5–9 人、每队出场 5 人；报名提交与最终名单都按此执行。",
    },
    {
      key: "stage-count",
      passed: capabilities.stagePlan.length === 4,
      reason: "标准 Major 必须包含三个瑞士轮阶段和一个淘汰赛阶段。",
    },
    {
      key: "stage-order",
      passed: capabilities.stagePlan.map(({ type }) => type).join("|") === "swiss|swiss|swiss|single_elim",
      reason: "标准 Major 的阶段顺序必须为阶段一、阶段二、阶段三瑞士轮，随后是单败淘汰。",
    },
    {
      key: "swiss-match-format",
      passed: hasFrozenMajorSwissMatchFormats(stage1, stage2, stage3),
      reason: "NJU Major 阶段一、阶段二的普通比赛为 BO1，决定晋级或淘汰的比赛由 Swiss 引擎升级为 BO3；阶段三全部为 BO3。",
    },
    {
      key: "entry-cohorts",
      passed:
        directEntrantCount(stage1, true) === 16 &&
        directEntrantCount(stage2) === 8 &&
        directEntrantCount(stage3) === 8 &&
        directEntrantCount(playoff) === 0,
      reason: "标准 Major 必须按 16 / 8 / 8 三批队伍进入三个瑞士轮阶段，并由阶段三的 8 支晋级队进入淘汰赛。",
    },
    {
      key: "stage1-seeds",
      passed: hasStandardStageOneSeeds(stage1?.seeds),
      reason: "阶段一必须完整且唯一地使用 17–32 号种子。",
    },
    {
      key: "affiliation-rule",
      passed: capabilities.affiliationRules.some((rule) =>
        rule.institutionCode === "4132010284" &&
        rule.eligibleAcademicStatuses.includes("enrolled") &&
        rule.eligibleAcademicStatuses.includes("graduated") &&
        rule.minRosterMembers === 3 &&
        rule.minStartingMembers === 3,
      ),
      reason: "标准 Major 必须冻结南京大学在读/毕业成员名单至少 3 人、首发至少 3 人的高校归属规则。",
    },
    {
      key: "stage1",
      passed: stage1?.type === "swiss" && stage1.teamCount === 16 && advancesEight(stage1),
      reason: "阶段一必须为 16 队瑞士轮，8 队晋级。",
    },
    {
      key: "stage2",
      passed: stage2?.type === "swiss" && stage2.teamCount === 16 && advancesEight(stage2),
      reason: "阶段二必须为 16 队瑞士轮，8 队晋级。",
    },
    {
      key: "stage3",
      passed: stage3?.type === "swiss" && stage3.teamCount === 16 && advancesEight(stage3),
      reason: "阶段三必须为 16 队瑞士轮，8 队晋级。",
    },
    {
      key: "playoff",
      passed: playoff?.type === "single_elim" && playoff.teamCount === 8 && playoff.matchFormat === "bo3" && playoff.finalFormat === "bo5",
      reason: "淘汰赛必须为 8 队单败淘汰，四分之一决赛和半决赛 BO3、决赛 BO5。",
    },
  ];
  const failures = checks.filter((check) => !check.passed);
  return { isStandardMajor: failures.length === 0, checks, failures };
}

/** Read-only migration verifier for rows predating the explicit affiliation rule. */
export function isLegacyStandardMajorWithoutAffiliation(capabilities: SeasonCapabilities): boolean {
  return normalizeAffiliationRules(capabilities.affiliationRules).length === 0 &&
    checkStandardMajorCapabilities({
      ...capabilities,
      affiliationRules: MAJOR_DEFAULT_CAPABILITIES.affiliationRules,
    }).isStandardMajor;
}

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
